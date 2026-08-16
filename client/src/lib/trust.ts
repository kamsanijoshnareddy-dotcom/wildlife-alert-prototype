import type { Incident } from "@shared/schema";

export type TrustTier = "low" | "medium" | "high";

/** Traffic-light tiering: green (low/monitoring), amber (medium/pending), red (high/alert). */
export function trustTier(trustScore: number, alertThreshold: number): TrustTier {
  if (trustScore >= alertThreshold) return "high";
  if (trustScore >= alertThreshold * 0.6) return "medium";
  return "low";
}

export const TIER_LABEL: Record<TrustTier, string> = {
  low: "Monitoring",
  medium: "Pending",
  high: "Alert Fired",
};

export const TIER_HEX: Record<TrustTier, string> = {
  low: "#22c55e",
  medium: "#eab308",
  high: "#ef4444",
};

export function incidentRemainingFraction(incident: Incident, now: number): number {
  const total = incident.expiresAt - incident.createdAt;
  if (total <= 0) return 0;
  const remaining = incident.expiresAt - now;
  return Math.max(0, Math.min(1, remaining / total));
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

export function parseBreakdown(incident: Incident): ScoreBreakdown {
  return JSON.parse(incident.scoreBreakdown);
}
