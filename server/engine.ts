// Core corroboration / trust-scoring engine.
// All logic here is real, computed server-side from the events/vehicles/zones
// actually stored in the database — nothing here is hardcoded or faked.
import { storage } from "./storage";
import type { Event, HotspotZone, Vehicle, Settings, Incident } from "@shared/schema";

// ---------------------------------------------------------------------------
// Tunables (demo-compressed per spec; NOT the production ~20-30 min decay)
// ---------------------------------------------------------------------------
export const CLUSTER_RADIUS_M = 400; // spatial clustering radius
export const CLUSTER_WINDOW_MS = 90_000; // rolling temporal window (90s)
export const CLUSTER_HEADING_DEG = 45; // directional tolerance
export const DECAY_HALF_LIFE_MS = 50_000; // ~50s demo decay half-life (45-60s range)

// ---------------------------------------------------------------------------
// Geo helpers
// ---------------------------------------------------------------------------
const EARTH_RADIUS_M = 6371000;

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

function headingDelta(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// ---------------------------------------------------------------------------
// Score component helpers
// ---------------------------------------------------------------------------

/** Diminishing-returns reward for corroborating vehicle count N. */
export function corroborationFactor(distinctVehicleCount: number): number {
  const n = Math.max(1, distinctVehicleCount);
  return Math.min(1, Math.log(n + 1) / Math.log(5));
}

/** Nearest / distance-weighted hotspot prior for a given point. */
export function hotspotPriorFor(lat: number, lon: number, zones: HotspotZone[]): number {
  if (zones.length === 0) return 0.3; // neutral prior if no zones seeded
  // Distance-weighted blend, dominated by the nearest zone.
  const withDist = zones.map((z) => ({
    z,
    d: haversineMeters(lat, lon, z.lat, z.lon),
  }));
  withDist.sort((a, b) => a.d - b.d);
  const nearest = withDist[0];
  // If well within the nearest zone's radius, weight it heavily.
  // Otherwise blend with an inverse-distance-weighted average of all zones.
  if (nearest.d <= nearest.z.radiusM) {
    return nearest.z.historicalRiskScore;
  }
  let weightSum = 0;
  let scoreSum = 0;
  for (const { z, d } of withDist) {
    const w = 1 / Math.max(1, d) ** 2;
    weightSum += w;
    scoreSum += w * z.historicalRiskScore;
  }
  return weightSum > 0 ? scoreSum / weightSum : 0.3;
}

/** Species agreement + spatiotemporal tightness -> agreement_score in [0,1]. */
export function agreementScore(clusterEvents: Event[]): number {
  if (clusterEvents.length <= 1) return 1;
  const speciesCounts = new Map<string, number>();
  for (const e of clusterEvents) {
    speciesCounts.set(e.species, (speciesCounts.get(e.species) ?? 0) + 1);
  }
  // "unknown" species reports neither help nor hurt agreement strongly —
  // treat them as compatible with any species.
  const nonUnknown = clusterEvents.filter((e) => e.species !== "unknown");
  let speciesAgreement = 1;
  if (nonUnknown.length > 1) {
    const counts = new Map<string, number>();
    for (const e of nonUnknown) counts.set(e.species, (counts.get(e.species) ?? 0) + 1);
    const maxCount = Math.max(...counts.values());
    speciesAgreement = maxCount / nonUnknown.length;
  }

  // Spatial tightness: average pairwise distance vs cluster radius.
  let totalDist = 0;
  let pairs = 0;
  for (let i = 0; i < clusterEvents.length; i++) {
    for (let j = i + 1; j < clusterEvents.length; j++) {
      totalDist += haversineMeters(
        clusterEvents[i].lat,
        clusterEvents[i].lon,
        clusterEvents[j].lat,
        clusterEvents[j].lon
      );
      pairs++;
    }
  }
  const avgDist = pairs > 0 ? totalDist / pairs : 0;
  const spatialTightness = Math.max(0, 1 - avgDist / CLUSTER_RADIUS_M);

  // Temporal tightness: average pairwise time gap vs window.
  let totalGap = 0;
  let tPairs = 0;
  for (let i = 0; i < clusterEvents.length; i++) {
    for (let j = i + 1; j < clusterEvents.length; j++) {
      totalGap += Math.abs(clusterEvents[i].timestamp - clusterEvents[j].timestamp);
      tPairs++;
    }
  }
  const avgGap = tPairs > 0 ? totalGap / tPairs : 0;
  const temporalTightness = Math.max(0, 1 - avgGap / CLUSTER_WINDOW_MS);

  const tightness = (spatialTightness + temporalTightness) / 2;
  // Blend: species agreement dominates, tightness refines it.
  return Math.max(0, Math.min(1, 0.7 * speciesAgreement + 0.3 * tightness));
}

export function weatherModifier(weather: Event["weather"]): number {
  // Small boost for low-visibility conditions; neutral/slight penalty for clear.
  switch (weather) {
    case "fog":
      return 1.0;
    case "night":
      return 0.85;
    case "rain":
      return 0.6;
    case "clear":
    default:
      return 0.2;
  }
}

export function timeOfDayModifier(timeOfDay: Settings["timeOfDay"]): number {
  // Small boost for dawn/dusk (peak wildlife activity) vs midday/night.
  switch (timeOfDay) {
    case "dawn":
    case "dusk":
      return 1.0;
    case "night":
      return 0.5;
    case "midday":
    default:
      return 0.15;
  }
}

export interface ScoreBreakdown {
  aiConfidenceTerm: number;
  corroborationTerm: number;
  agreementTerm: number;
  reliabilityTerm: number;
  hotspotTerm: number;
  weatherTerm: number;
  timeOfDayTerm: number;
  rawAiConfidence: number;
  rawCorroboration: number;
  rawAgreement: number;
  rawReliability: number;
  rawHotspotPrior: number;
  rawWeather: number;
  rawTimeOfDay: number;
  distinctVehicleCount: number;
}

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Computes the full trust score for a cluster of events given the current
 * vehicles, hotspot zones, and tunable weights/settings. Pure function of
 * real stored data — implements the formula from the build spec exactly.
 */
export function computeTrustScore(
  clusterEvents: Event[],
  vehiclesById: Map<number, Vehicle>,
  zones: HotspotZone[],
  settings: Settings
): { trustScore: number; breakdown: ScoreBreakdown; hotspotPrior: number } {
  const aiEvents = clusterEvents.filter(
    (e) => e.sourceType === "ai_detection" && e.aiConfidence != null
  );
  const rawAiConfidence =
    aiEvents.length > 0
      ? aiEvents.reduce((s, e) => s + (e.aiConfidence ?? 0), 0) / aiEvents.length
      : 0.5;

  const distinctVehicleIds = new Set(clusterEvents.map((e) => e.vehicleId));
  const rawCorroboration = corroborationFactor(distinctVehicleIds.size);

  const rawAgreement = agreementScore(clusterEvents);

  const reliabilities = Array.from(distinctVehicleIds).map(
    (vid) => vehiclesById.get(vid)?.reliabilityScore ?? 0.5
  );
  const rawReliability =
    reliabilities.length > 0
      ? reliabilities.reduce((s, r) => s + r, 0) / reliabilities.length
      : 0.5;

  // Centroid for hotspot lookup
  const centroidLat = clusterEvents.reduce((s, e) => s + e.lat, 0) / clusterEvents.length;
  const centroidLon = clusterEvents.reduce((s, e) => s + e.lon, 0) / clusterEvents.length;
  const rawHotspotPrior = hotspotPriorFor(centroidLat, centroidLon, zones);

  // Weather/time-of-day modifiers reflect the *most recent* event's conditions,
  // which track the live global weather/time-of-day toggle at submission time.
  const latestEvent = clusterEvents.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
  const rawWeather = weatherModifier(latestEvent.weather);
  const rawTimeOfDay = timeOfDayModifier(settings.timeOfDay);

  const aiConfidenceTerm = settings.wAiConfidence * rawAiConfidence;
  const corroborationTerm = settings.wCorroboration * rawCorroboration;
  const agreementTerm = settings.wAgreement * rawAgreement;
  const reliabilityTerm = settings.wReliability * rawReliability;
  const hotspotTerm = settings.wHotspotPrior * rawHotspotPrior;
  const weatherTerm = settings.wWeather * rawWeather;
  const timeOfDayTerm = settings.wTimeOfDay * rawTimeOfDay;

  const trustScore = clamp01(
    aiConfidenceTerm +
      corroborationTerm +
      agreementTerm +
      reliabilityTerm +
      hotspotTerm +
      weatherTerm +
      timeOfDayTerm
  );

  return {
    trustScore,
    hotspotPrior: rawHotspotPrior,
    breakdown: {
      aiConfidenceTerm,
      corroborationTerm,
      agreementTerm,
      reliabilityTerm,
      hotspotTerm,
      weatherTerm,
      timeOfDayTerm,
      rawAiConfidence,
      rawCorroboration,
      rawAgreement,
      rawReliability,
      rawHotspotPrior,
      rawWeather,
      rawTimeOfDay,
      distinctVehicleCount: distinctVehicleIds.size,
    },
  };
}

/**
 * Given a new event, find a matching pending/non-expired incident using
 * spatial + temporal + directional clustering rules, or return null to
 * signal a new incident should be created.
 */
export async function findMatchingIncident(
  newEvent: Event,
  now: number
): Promise<{ incident: Incident; events: Event[] } | null> {
  const activeIncidents = (await storage.listIncidents()).filter(
    (i) => i.status !== "expired"
  );
  const allEvents = await storage.listEvents();

  for (const incident of activeIncidents) {
    const memberIds: number[] = JSON.parse(incident.eventIds);
    const memberEvents = allEvents.filter((e) => memberIds.includes(e.id));
    if (memberEvents.length === 0) continue;

    // Spatial: within CLUSTER_RADIUS_M of the incident centroid.
    const spatialOk =
      haversineMeters(newEvent.lat, newEvent.lon, incident.centroidLat, incident.centroidLon) <=
      CLUSTER_RADIUS_M;
    if (!spatialOk) continue;

    // Temporal: within rolling window of the most recent member event.
    const mostRecent = memberEvents.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
    const temporalOk = Math.abs(newEvent.timestamp - mostRecent.timestamp) <= CLUSTER_WINDOW_MS;
    if (!temporalOk) continue;

    // Directional: heading within tolerance of at least one member event.
    const directionalOk = memberEvents.some(
      (e) => headingDelta(e.heading, newEvent.heading) <= CLUSTER_HEADING_DEG
    );
    if (!directionalOk) continue;

    return { incident, events: memberEvents };
  }
  return null;
}

/**
 * Recomputes and persists the trust score + status + decay for a single
 * incident from its member events. Called after clustering a new event,
 * and whenever weights/threshold change (live re-scoring).
 */
export async function rescoreIncident(incidentId: number): Promise<Incident | undefined> {
  const incident = await storage.getIncident(incidentId);
  if (!incident || incident.status === "expired") return incident;

  const memberIds: number[] = JSON.parse(incident.eventIds);
  const allEvents = await storage.listEvents();
  const memberEvents = allEvents.filter((e) => memberIds.includes(e.id));
  if (memberEvents.length === 0) return incident;

  const allVehicles = await storage.listVehicles();
  const vehiclesById = new Map(allVehicles.map((v) => [v.id, v]));
  const zones = await storage.listHotspotZones();
  const settings = await storage.getSettings();

  const { trustScore, breakdown, hotspotPrior } = computeTrustScore(
    memberEvents,
    vehiclesById,
    zones,
    settings
  );

  const now = Date.now();
  const centroidLat = memberEvents.reduce((s, e) => s + e.lat, 0) / memberEvents.length;
  const centroidLon = memberEvents.reduce((s, e) => s + e.lon, 0) / memberEvents.length;

  const newStatus =
    incident.status === "alert_fired" && trustScore < settings.alertThreshold
      ? "alert_fired" // once fired, don't un-fire on a live weight tweak — only decay/expire can end it
      : trustScore >= settings.alertThreshold
        ? "alert_fired"
        : "pending";

  return storage.updateIncident(incidentId, {
    centroidLat,
    centroidLon,
    trustScore,
    hotspotPrior,
    status: newStatus,
    scoreBreakdown: JSON.stringify(breakdown),
    lastUpdatedAt: now,
  });
}

/** Recomputes every non-expired incident (used after a global weight/threshold change). */
export async function rescoreAllActiveIncidents(): Promise<void> {
  const active = await storage.listIncidents();
  for (const inc of active) {
    if (inc.status === "expired") continue;
    await rescoreIncident(inc.id);
  }
}

/**
 * Main entry point: process a newly-submitted event. Clusters it into an
 * existing incident or creates a new one, then (re)computes the trust score
 * and, crucially, extends/creates the decay timer (expiresAt).
 */
export async function processNewEvent(event: Event): Promise<Incident> {
  const now = Date.now();
  const match = await findMatchingIncident(event, now);
  const settings = await storage.getSettings();

  if (match) {
    const memberIds: number[] = JSON.parse(match.incident.eventIds);
    memberIds.push(event.id);
    await storage.updateIncident(match.incident.id, {
      eventIds: JSON.stringify(memberIds),
      expiresAt: now + DECAY_HALF_LIFE_MS, // corroborating event resets/extends decay
    });
    const rescored = await rescoreIncident(match.incident.id);
    return rescored!;
  }

  // No match: create a brand-new incident seeded by this single live event.
  // (Per spec: zones must always originate from at least one live event —
  // never purely from hotspot_zones table alone.)
  const allVehicles = await storage.listVehicles();
  const vehiclesById = new Map(allVehicles.map((v) => [v.id, v]));
  const zones = await storage.listHotspotZones();
  const { trustScore, breakdown, hotspotPrior } = computeTrustScore(
    [event],
    vehiclesById,
    zones,
    settings
  );

  const status = trustScore >= settings.alertThreshold ? "alert_fired" : "pending";

  return storage.createIncident({
    centroidLat: event.lat,
    centroidLon: event.lon,
    trustScore,
    hotspotPrior,
    status,
    eventIds: JSON.stringify([event.id]),
    scoreBreakdown: JSON.stringify(breakdown),
    createdAt: now,
    lastUpdatedAt: now,
    expiresAt: now + DECAY_HALF_LIFE_MS,
  });
}

/** Applies feedback-driven reliability updates to every vehicle behind an incident. */
export async function applyFeedback(
  incidentId: number,
  response: "confirmed" | "denied"
): Promise<void> {
  const incident = await storage.getIncident(incidentId);
  if (!incident) return;
  const memberIds: number[] = JSON.parse(incident.eventIds);
  const allEvents = await storage.listEvents();
  const memberEvents = allEvents.filter((e) => memberIds.includes(e.id));
  const distinctVehicleIds = new Set(memberEvents.map((e) => e.vehicleId));

  for (const vehicleId of distinctVehicleIds) {
    const vehicle = await storage.getVehicle(vehicleId);
    if (!vehicle) continue;
    const delta = response === "confirmed" ? 0.05 : -0.08;
    const next =
      response === "confirmed"
        ? Math.min(1.0, vehicle.reliabilityScore + delta)
        : Math.max(0.05, vehicle.reliabilityScore + delta);
    await storage.updateVehicleReliability(vehicleId, next);
  }

  // Reliability changed -> rescore this incident to reflect the update immediately.
  await rescoreIncident(incidentId);
}
