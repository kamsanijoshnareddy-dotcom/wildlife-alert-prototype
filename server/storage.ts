import {
  vehicles,
  events,
  incidents,
  hotspotZones,
  feedback,
  settings,
} from "@shared/schema";
import type {
  Vehicle,
  InsertVehicle,
  Event,
  InsertEvent,
  Incident,
  InsertIncident,
  HotspotZone,
  InsertHotspotZone,
  Feedback,
  InsertFeedback,
  Settings,
  UpdateSettings,
} from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

// Ensure tables exist (demo prototype — create if missing instead of requiring a migration step)
sqlite.exec(`
CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  heading REAL NOT NULL,
  speed_kph REAL NOT NULL,
  reliability_score REAL NOT NULL DEFAULT 0.5,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  ai_confidence REAL,
  species TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  heading REAL NOT NULL,
  speed_kph REAL NOT NULL,
  weather TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  centroid_lat REAL NOT NULL,
  centroid_lon REAL NOT NULL,
  trust_score REAL NOT NULL,
  hotspot_prior REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  event_ids TEXT NOT NULL,
  score_breakdown TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS hotspot_zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  radius_m REAL NOT NULL,
  historical_risk_score REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL,
  vehicle_id INTEGER NOT NULL,
  response TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  w_ai_confidence REAL NOT NULL DEFAULT 0.25,
  w_corroboration REAL NOT NULL DEFAULT 0.2,
  w_agreement REAL NOT NULL DEFAULT 0.15,
  w_reliability REAL NOT NULL DEFAULT 0.15,
  w_hotspot_prior REAL NOT NULL DEFAULT 0.15,
  w_weather REAL NOT NULL DEFAULT 0.05,
  w_time_of_day REAL NOT NULL DEFAULT 0.05,
  alert_threshold REAL NOT NULL DEFAULT 0.6,
  time_of_day TEXT NOT NULL DEFAULT 'midday',
  global_weather TEXT NOT NULL DEFAULT 'clear'
);
`);

export interface IStorage {
  // vehicles
  listVehicles(): Promise<Vehicle[]>;
  getVehicle(id: number): Promise<Vehicle | undefined>;
  createVehicle(v: InsertVehicle): Promise<Vehicle>;
  updateVehicleReliability(id: number, reliabilityScore: number): Promise<void>;

  // events
  listEvents(): Promise<Event[]>;
  getEvent(id: number): Promise<Event | undefined>;
  createEvent(e: InsertEvent): Promise<Event>;

  // incidents
  listIncidents(): Promise<Incident[]>;
  listActiveIncidents(): Promise<Incident[]>;
  getIncident(id: number): Promise<Incident | undefined>;
  createIncident(i: InsertIncident): Promise<Incident>;
  updateIncident(id: number, patch: Partial<InsertIncident>): Promise<Incident | undefined>;
  expireStaleIncidents(now: number): Promise<number[]>;

  // hotspot zones
  listHotspotZones(): Promise<HotspotZone[]>;
  createHotspotZone(z: InsertHotspotZone): Promise<HotspotZone>;

  // feedback
  listFeedbackForIncident(incidentId: number): Promise<Feedback[]>;
  createFeedback(f: InsertFeedback): Promise<Feedback>;

  // settings
  getSettings(): Promise<Settings>;
  updateSettings(patch: UpdateSettings): Promise<Settings>;
}

export class DatabaseStorage implements IStorage {
  async listVehicles(): Promise<Vehicle[]> {
    return db.select().from(vehicles).all();
  }
  async getVehicle(id: number): Promise<Vehicle | undefined> {
    return db.select().from(vehicles).where(eq(vehicles.id, id)).get();
  }
  async createVehicle(v: InsertVehicle): Promise<Vehicle> {
    return db
      .insert(vehicles)
      .values({ ...v, createdAt: Date.now() })
      .returning()
      .get();
  }
  async updateVehicleReliability(id: number, reliabilityScore: number): Promise<void> {
    db.update(vehicles).set({ reliabilityScore }).where(eq(vehicles.id, id)).run();
  }

  async listEvents(): Promise<Event[]> {
    return db.select().from(events).all();
  }
  async getEvent(id: number): Promise<Event | undefined> {
    return db.select().from(events).where(eq(events.id, id)).get();
  }
  async createEvent(e: InsertEvent): Promise<Event> {
    return db
      .insert(events)
      .values({ ...e, timestamp: Date.now() })
      .returning()
      .get();
  }

  async listIncidents(): Promise<Incident[]> {
    return db.select().from(incidents).all();
  }
  async listActiveIncidents(): Promise<Incident[]> {
    return db
      .select()
      .from(incidents)
      .all()
      .filter((i) => i.status !== "expired");
  }
  async getIncident(id: number): Promise<Incident | undefined> {
    return db.select().from(incidents).where(eq(incidents.id, id)).get();
  }
  async createIncident(i: InsertIncident): Promise<Incident> {
    return db.insert(incidents).values(i).returning().get();
  }
  async updateIncident(
    id: number,
    patch: Partial<InsertIncident>
  ): Promise<Incident | undefined> {
    return db.update(incidents).set(patch).where(eq(incidents.id, id)).returning().get();
  }
  async expireStaleIncidents(now: number): Promise<number[]> {
    const stale = db
      .select()
      .from(incidents)
      .all()
      .filter((i) => i.status !== "expired" && i.expiresAt <= now);
    for (const inc of stale) {
      db.update(incidents).set({ status: "expired" }).where(eq(incidents.id, inc.id)).run();
    }
    return stale.map((i) => i.id);
  }

  async listHotspotZones(): Promise<HotspotZone[]> {
    return db.select().from(hotspotZones).all();
  }
  async createHotspotZone(z: InsertHotspotZone): Promise<HotspotZone> {
    return db.insert(hotspotZones).values(z).returning().get();
  }

  async listFeedbackForIncident(incidentId: number): Promise<Feedback[]> {
    return db.select().from(feedback).where(eq(feedback.incidentId, incidentId)).all();
  }
  async createFeedback(f: InsertFeedback): Promise<Feedback> {
    return db
      .insert(feedback)
      .values({ ...f, timestamp: Date.now() })
      .returning()
      .get();
  }

  async getSettings(): Promise<Settings> {
    const row = db.select().from(settings).get();
    if (row) return row;
    return db.insert(settings).values({}).returning().get();
  }
  async updateSettings(patch: UpdateSettings): Promise<Settings> {
    const current = await this.getSettings();
    return db.update(settings).set(patch).where(eq(settings.id, current.id)).returning().get();
  }
}

export const storage = new DatabaseStorage();
