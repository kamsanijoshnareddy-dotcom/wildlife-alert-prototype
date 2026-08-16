# Verified Wildlife Alert — Corroboration Engine Prototype

An interactive fullstack prototype demonstrating a multi-vehicle AI corroboration and
trust-scoring engine for wildlife-vehicle-collision alerts. Spawn simulated vehicles,
report sightings (AI detection or manual tap), and watch the server-side engine cluster
nearby reports, compute a weighted trust score, fire alerts above threshold, decay expired
zones, and adjust vehicle reliability from confirm/deny feedback — all in real time on a
MapLibre map centered on Celina, TX.

**None of the scoring, clustering, or decay is faked or hardcoded on the client.** Every
score shown in the UI comes from real server-side logic in `server/engine.ts` running
against a persistent SQLite database.

## Requirements

- Node.js 18+ (developed and tested on Node 20)
- npm

## Local setup

```bash
npm install
npm run dev
```

That's it — no separate migration or seed command is required:

- Tables are created automatically via `CREATE TABLE IF NOT EXISTS` statements in
  `server/storage.ts` the first time the server starts.
- The five hotspot/cold zones around Celina are auto-seeded on first boot by
  `seedHotspotZonesIfEmpty()` in `server/routes.ts`.
- A default `settings` row (trust-score weights + alert threshold) is created
  automatically the first time `/api/settings` is read.

The app runs on **http://localhost:5000** (both the API and the Vite-served frontend are
on the same port — there's nothing else to start). Set `PORT=<port>` to run on a different
port if 5000 is taken.

## Environment variables

None are required to run the prototype locally. A `.env` file is loaded via `dotenv` if
present, but the app runs correctly with no `.env` at all.

## Data storage

State (vehicles, events, incidents, hotspot zones, feedback, settings) is persisted to a
SQLite file at `data.db` in the project root, created automatically on first run. Delete
`data.db` (and any `data.db-shm` / `data.db-wal` files) to reset the simulation to a clean
slate.

## Production build

```bash
npm run build
npm start
```

`npm run build` bundles the client with Vite and the server with esbuild into `dist/`.
`npm start` serves the production build on port 5000 (or `$PORT`).

## What's implemented

- **Trust score formula** — weighted sum of AI confidence, corroboration count
  (logarithmic diminishing returns), cross-vehicle agreement, vehicle reliability,
  hotspot historical prior, weather modifier, and time-of-day modifier. Weights are
  live-tunable in the UI and always re-normalize existing active incidents.
- **Spatiotemporal clustering** — new sighting reports within 400m and 90 seconds of an
  existing active incident (and within a 45° heading cone) are merged into that incident
  instead of creating a new one, increasing its corroboration count.
- **Zone decay** — active incidents decay on a ~50 second half-life and flip to `expired`
  once their trust score would fall out of relevance; corroboration resets the decay
  clock. The frontend polls `/api/incidents` every ~2.5s so decay is visible live on the
  map without a manual refresh.
- **Feedback-driven reliability** — confirming an incident nudges each contributing
  vehicle's reliability score up (+0.05, capped at 1.0); denying nudges it down (−0.08,
  floored at 0.05). Reliability feeds back into future trust-score calculations for that
  vehicle.

## Tech stack

Express + Vite + React + Tailwind + shadcn/ui + Drizzle ORM + better-sqlite3, with
MapLibre GL JS and OpenFreeMap vector tiles for the map.
