import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ---------------------------------------------------------------------------
// vehicles — simulated vehicles the user spawns on the map
// ---------------------------------------------------------------------------
export const vehicles = sqliteTable("vehicles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  heading: real("heading").notNull(), // degrees, 0-360
  speedKph: real("speed_kph").notNull(),
  reliabilityScore: real("reliability_score").notNull().default(0.5),
  createdAt: integer("created_at").notNull(),
});

export const insertVehicleSchema = createInsertSchema(vehicles).omit({
  id: true,
  createdAt: true,
});
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Vehicle = typeof vehicles.$inferSelect;

// ---------------------------------------------------------------------------
// events — raw sighting reports submitted by a vehicle
// ---------------------------------------------------------------------------
export const SPECIES = ["deer", "elk", "moose", "unknown"] as const;
export const WEATHER = ["clear", "rain", "fog", "night"] as const;
export const SOURCE_TYPE = ["ai_detection", "manual_tap"] as const;

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  vehicleId: integer("vehicle_id").notNull(),
  sourceType: text("source_type", { enum: SOURCE_TYPE }).notNull(),
  aiConfidence: real("ai_confidence"), // nullable
  species: text("species", { enum: SPECIES }).notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  heading: real("heading").notNull(),
  speedKph: real("speed_kph").notNull(),
  weather: text("weather", { enum: WEATHER }).notNull(),
  timestamp: integer("timestamp").notNull(),
});

export const insertEventSchema = createInsertSchema(events)
  .omit({ id: true, timestamp: true })
  .extend({
    species: z.enum(SPECIES),
    weather: z.enum(WEATHER),
    sourceType: z.enum(SOURCE_TYPE),
    aiConfidence: z.number().min(0).max(1).nullable().optional(),
  });
export type InsertEvent = z.infer<typeof insertEventSchema>;
export type Event = typeof events.$inferSelect;

// ---------------------------------------------------------------------------
// incidents — clustered groups of events with a computed trust score
// ---------------------------------------------------------------------------
export const INCIDENT_STATUS = ["pending", "alert_fired", "expired"] as const;

export const incidents = sqliteTable("incidents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  centroidLat: real("centroid_lat").notNull(),
  centroidLon: real("centroid_lon").notNull(),
  trustScore: real("trust_score").notNull(),
  hotspotPrior: real("hotspot_prior").notNull(),
  status: text("status", { enum: INCIDENT_STATUS }).notNull().default("pending"),
  eventIds: text("event_ids").notNull(), // JSON array of event ids (text, SQLite has no array columns)
  scoreBreakdown: text("score_breakdown").notNull(), // JSON: per-component contributions
  createdAt: integer("created_at").notNull(),
  lastUpdatedAt: integer("last_updated_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const insertIncidentSchema = createInsertSchema(incidents).omit({
  id: true,
});
export type InsertIncident = z.infer<typeof insertIncidentSchema>;
export type Incident = typeof incidents.$inferSelect;

// ---------------------------------------------------------------------------
// hotspot_zones — preset zones along the demo road with historical risk
// ---------------------------------------------------------------------------
export const hotspotZones = sqliteTable("hotspot_zones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  lat: real("lat").notNull(),
  lon: real("lon").notNull(),
  radiusM: real("radius_m").notNull(),
  historicalRiskScore: real("historical_risk_score").notNull(),
});

export const insertHotspotZoneSchema = createInsertSchema(hotspotZones).omit({
  id: true,
});
export type InsertHotspotZone = z.infer<typeof insertHotspotZoneSchema>;
export type HotspotZone = typeof hotspotZones.$inferSelect;

// ---------------------------------------------------------------------------
// feedback — confirm/deny responses tied to an incident
// ---------------------------------------------------------------------------
export const FEEDBACK_RESPONSE = ["confirmed", "denied"] as const;

export const feedback = sqliteTable("feedback", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  incidentId: integer("incident_id").notNull(),
  vehicleId: integer("vehicle_id").notNull(),
  response: text("response", { enum: FEEDBACK_RESPONSE }).notNull(),
  timestamp: integer("timestamp").notNull(),
});

export const insertFeedbackSchema = createInsertSchema(feedback)
  .omit({ id: true, timestamp: true })
  .extend({ response: z.enum(FEEDBACK_RESPONSE) });
export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;
export type Feedback = typeof feedback.$inferSelect;

// ---------------------------------------------------------------------------
// settings — algorithm weights + alert threshold (single row, in DB)
// ---------------------------------------------------------------------------
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  wAiConfidence: real("w_ai_confidence").notNull().default(0.25),
  wCorroboration: real("w_corroboration").notNull().default(0.2),
  wAgreement: real("w_agreement").notNull().default(0.15),
  wReliability: real("w_reliability").notNull().default(0.15),
  wHotspotPrior: real("w_hotspot_prior").notNull().default(0.15),
  wWeather: real("w_weather").notNull().default(0.05),
  wTimeOfDay: real("w_time_of_day").notNull().default(0.05),
  alertThreshold: real("alert_threshold").notNull().default(0.6),
  timeOfDay: text("time_of_day", {
    enum: ["dawn", "midday", "dusk", "night"],
  })
    .notNull()
    .default("midday"),
  globalWeather: text("global_weather", { enum: WEATHER }).notNull().default("clear"),
});

export const updateSettingsSchema = createInsertSchema(settings).omit({ id: true }).partial();
export type UpdateSettings = z.infer<typeof updateSettingsSchema>;
export type Settings = typeof settings.$inferSelect;
