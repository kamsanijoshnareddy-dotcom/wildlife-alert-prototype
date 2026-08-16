import type { Express } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { storage } from "./storage";
import {
  insertVehicleSchema,
  insertEventSchema,
  insertFeedbackSchema,
  updateSettingsSchema,
} from "@shared/schema";
import { processNewEvent, applyFeedback, rescoreAllActiveIncidents } from "./engine";

// Demo road corridor near Celina, TX (approx 33.3255 N, -96.7847 W)
const ROAD_CENTER = { lat: 33.3255, lon: -96.7847 };
const ROAD_BEARING_DEG = 32; // roughly NE-SW running rural highway

function pointAlongRoad(t: number, lateralOffsetM = 0) {
  // t in [-1, 1] maps along ~6km of road centered on ROAD_CENTER
  const halfLengthM = 3000;
  const distM = t * halfLengthM;
  const bearingRad = (ROAD_BEARING_DEG * Math.PI) / 180;
  const dLat = (distM * Math.cos(bearingRad)) / 111320;
  const dLon =
    (distM * Math.sin(bearingRad)) / (111320 * Math.cos((ROAD_CENTER.lat * Math.PI) / 180));
  // lateral offset perpendicular to bearing
  const perpBearingRad = bearingRad + Math.PI / 2;
  const latOffset = (lateralOffsetM * Math.cos(perpBearingRad)) / 111320;
  const lonOffset =
    (lateralOffsetM * Math.sin(perpBearingRad)) /
    (111320 * Math.cos((ROAD_CENTER.lat * Math.PI) / 180));
  return {
    lat: ROAD_CENTER.lat + dLat + latOffset,
    lon: ROAD_CENTER.lon + dLon + lonOffset,
  };
}

async function seedHotspotZonesIfEmpty() {
  const existing = await storage.listHotspotZones();
  if (existing.length > 0) return;

  const zoneDefs = [
    { t: -0.75, name: "Deer Creek Crossing", risk: 0.85 },
    { t: -0.25, name: "Bluff Hollow Woods", risk: 0.78 },
    { t: 0.15, name: "Prairie Overpass", risk: 0.15 },
    { t: 0.5, name: "Millrace Straightaway", risk: 0.12 },
    { t: 0.85, name: "Cedar Ridge Bend", risk: 0.6 },
  ];
  for (const zd of zoneDefs) {
    const pos = pointAlongRoad(zd.t);
    await storage.createHotspotZone({
      name: zd.name,
      lat: pos.lat,
      lon: pos.lon,
      radiusM: 500,
      historicalRiskScore: zd.risk,
    });
  }
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  await seedHotspotZonesIfEmpty();
  await storage.getSettings(); // ensure a settings row exists

  // -------------------------------------------------------------------
  // Road metadata (for frontend map centering + vehicle spawn helper)
  // -------------------------------------------------------------------
  app.get("/api/road", (_req, res) => {
    res.json({ center: ROAD_CENTER, bearingDeg: ROAD_BEARING_DEG });
  });

  // -------------------------------------------------------------------
  // Vehicles
  // -------------------------------------------------------------------
  app.get("/api/vehicles", async (_req, res) => {
    res.json(await storage.listVehicles());
  });

  app.post("/api/vehicles", async (req, res) => {
    try {
      const body = insertVehicleSchema.partial().parse(req.body ?? {});
      const t = Math.random() * 2 - 1;
      const lateral = (Math.random() - 0.5) * 20;
      const pos = pointAlongRoad(t, lateral);
      const heading = Math.round(Math.random() * 360);
      const speed = Math.round(70 + Math.random() * 40);
      const count = (await storage.listVehicles()).length;
      const vehicle = await storage.createVehicle({
        label: body.label ?? `Vehicle ${String.fromCharCode(65 + (count % 26))}`,
        lat: body.lat ?? pos.lat,
        lon: body.lon ?? pos.lon,
        heading: body.heading ?? heading,
        speedKph: body.speedKph ?? speed,
        reliabilityScore: body.reliabilityScore ?? 0.5,
      });
      res.status(201).json(vehicle);
    } catch (err: any) {
      res.status(400).json({ message: err?.message ?? "Invalid vehicle payload" });
    }
  });

  // -------------------------------------------------------------------
  // Events — submitting an event triggers clustering + scoring
  // -------------------------------------------------------------------
  app.get("/api/events", async (_req, res) => {
    res.json(await storage.listEvents());
  });

  app.post("/api/events", async (req, res) => {
    try {
      const parsed = insertEventSchema.parse(req.body);
      const vehicle = await storage.getVehicle(parsed.vehicleId);
      if (!vehicle) {
        return res.status(400).json({ message: "Unknown vehicle_id" });
      }
      const event = await storage.createEvent(parsed);
      const incident = await processNewEvent(event);
      res.status(201).json({ event, incident });
    } catch (err: any) {
      res.status(400).json({ message: err?.message ?? "Invalid event payload" });
    }
  });

  // -------------------------------------------------------------------
  // Incidents
  // -------------------------------------------------------------------
  app.get("/api/incidents", async (req, res) => {
    const now = Date.now();
    await storage.expireStaleIncidents(now);
    const activeOnly = req.query.active === "true";
    const all = await storage.listIncidents();
    res.json(activeOnly ? all.filter((i) => i.status !== "expired") : all);
  });

  app.get("/api/incidents/:id", async (req, res) => {
    const incident = await storage.getIncident(Number(req.params.id));
    if (!incident) return res.status(404).json({ message: "Not found" });
    res.json(incident);
  });

  // -------------------------------------------------------------------
  // Feedback — confirm/deny an incident, adjusts vehicle reliability
  // -------------------------------------------------------------------
  app.post("/api/feedback", async (req, res) => {
    try {
      const parsed = insertFeedbackSchema.parse(req.body);
      const incident = await storage.getIncident(parsed.incidentId);
      if (!incident) return res.status(400).json({ message: "Unknown incident_id" });
      const fb = await storage.createFeedback(parsed);
      await applyFeedback(parsed.incidentId, parsed.response);
      res.status(201).json(fb);
    } catch (err: any) {
      res.status(400).json({ message: err?.message ?? "Invalid feedback payload" });
    }
  });

  // -------------------------------------------------------------------
  // Hotspot zones
  // -------------------------------------------------------------------
  app.get("/api/hotspot-zones", async (_req, res) => {
    res.json(await storage.listHotspotZones());
  });

  // -------------------------------------------------------------------
  // Settings (weights + threshold) — live-tunable, triggers rescoring
  // -------------------------------------------------------------------
  app.get("/api/settings", async (_req, res) => {
    res.json(await storage.getSettings());
  });

  app.put("/api/settings", async (req, res) => {
    try {
      const patch = updateSettingsSchema.parse(req.body);
      const updated = await storage.updateSettings(patch);
      await rescoreAllActiveIncidents();
      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err?.message ?? "Invalid settings payload" });
    }
  });

  // -------------------------------------------------------------------
  // Stats — dashboard strip
  // -------------------------------------------------------------------
  app.get("/api/stats", async (_req, res) => {
    const now = Date.now();
    await storage.expireStaleIncidents(now);
    const [allEvents, allIncidents, allVehicles] = await Promise.all([
      storage.listEvents(),
      storage.listIncidents(),
      storage.listVehicles(),
    ]);
    const alertsFired = allIncidents.filter((i) => i.status === "alert_fired").length;
    const avgTrust =
      allIncidents.length > 0
        ? allIncidents.reduce((s, i) => s + i.trustScore, 0) / allIncidents.length
        : 0;
    res.json({
      totalEvents: allEvents.length,
      totalIncidents: allIncidents.length,
      alertsFired,
      avgTrustScore: avgTrust,
      activeZones: allIncidents.filter((i) => i.status !== "expired").length,
      vehicles: allVehicles,
    });
  });

  return httpServer;
}
