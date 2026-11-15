# Wind Farm API — Part 1 + Part 2

A Node.js + TypeScript web API that retrieves historical weather data from
AEMET (the Spanish Meteorological Agency) for the Business Development team's
wind farm feasibility study — Part 1 for the two Spanish Antarctic stations,
Part 2 (this iteration) for **all ~926 AEMET stations**, served through a
**SQLite read-through cache** with structured logging, so thousands of
internal requests never overload the AEMET OpenData API.

Part 2 requirements covered:

- **SQLite storage** of everything read from the source API
  (better-sqlite3, WAL, versioned migrations, prepared statements,
  transactional upserts)
- **Read-through caching** that never re-fetches what cannot have changed
  (immutable history) and refreshes only the mutable tail on a TTL
- **Proper logging** (pino, JSON, request ids — API keys are never logged)
- **High availability**: stale data is served with an explicit flag when
  the upstream fails; `/api/health` for monitoring

## Stack

| Concern | Choice |
|---|---|
| Language | TypeScript (strict mode), ESM |
| HTTP framework | Express 5 |
| Validation | Zod |
| Time zones / DST | Luxon |
| Storage | SQLite via better-sqlite3 (WAL, migrations) |
| Logging | pino |
| HTTP client | Native `fetch` |
| Tests | Vitest + Supertest (64 passing, zero network) |
| Dev workflow | `tsx watch` (dev), `tsc` (build) |

## Getting started

**Prerequisites:** Node.js ≥ 20 and npm.

1. Get a free AEMET API key at
   <https://opendata.aemet.es/centrodedescargas/inicio>
   ⚠️ register with a **personal** e-mail account — corporate accounts are
   blocked. **Since July 2026 new keys expire after 3 months** — renew when
   upstream starts answering `aemet_invalid_api_key`.
2. Copy `.env.example` to `.env` and paste your key.
3. Install and run:

   ```bash
   npm install
   npm run dev     # development, auto-reload: http://localhost:3000
   ```

   Or the production way:

   ```bash
   npm run build
   npm start
   ```

4. Run the tests (they never touch the real AEMET API):

   ```bash
   npm test
   ```

The SQLite cache lives at `DB_PATH` (default `./data/windfarm.sqlite`,
git-ignored) and is created on first boot; the station catalog syncs from
AEMET at startup and then daily.

## API reference

### Canonical route (Part 2): all stations

```
GET /api/datos/fechaini/{fechaIniStr}/fechafin/{fechaFinStr}/estacion/{identificacion}
```

`{identificacion}` is an AEMET station id (the catalog "indicativo", e.g.
`8178D`). Any station of the [official inventory](https://opendata.aemet.es/centrodedescargas/inicio)
can be requested, plus the two seeded Antarctic stations `89064` /
`89070`. Unknown stations get a `400 bad_request`.

Query parameters are the same as Part 1 (`location`, `aggregation`,
`types`), with identical semantics.

**Response** — Part 1's contract plus cache metadata and per-row granularity:

```json
{
  "station": "ALBACETE",
  "stationId": "8178D",
  "start": "2026-11-01T01:00:00+01:00",
  "end": "2026-11-15T13:00:00+01:00",
  "timezone": "Europe/Madrid",
  "aggregation": "none",
  "types": ["temperature", "pressure", "speed"],
  "count": 2,
  "data": [
    {
      "datetime": "2026-11-02T00:00:00+01:00",
      "granularity": "daily",
      "samples": null,
      "temperature": 13.2,
      "pressure": 941.35,
      "speed": 0.8
    },
    {
      "datetime": "2026-11-15T11:00:00+01:00",
      "granularity": "observation",
      "samples": 1,
      "temperature": 10.0,
      "pressure": 943.1,
      "speed": 0.8
    }
  ],
  "stale": false,
  "partial": false,
  "lastSyncedAt": "2026-11-15T13:00:00+01:00"
}
```

- `granularity` tells you which upstream tier a row came from. AEMET has
  **no historical 10-minute product** for regular stations, so the service
  is a two-tier composite:
  - `"daily"` — daily climatology (`tmed` → temperature, mean of
    `presMax`/`presMin` → pressure, `velmedia` → speed) for the historical
    part of the range. `samples` is `null` because these are
    source-provided daily summaries, not sample means.
  - `"observation"` — conventional observations (native cadence, often
    hourly, station-dependent) for roughly the last 24 hours.
  - The two Antarctic stations keep their rich 10-minute `antartida`
    product for **any** range (also labeled `"observation"`).
- `stale: true` — data was served although refreshing from AEMET failed
  (high availability: slightly old data beats an outage).
- `partial: true` — only some of the requested products could be
  refreshed.
- `lastSyncedAt` — when the served data was last actually fetched from
  AEMET.

**Aggregation semantics with mixed tiers:** `hourly` buckets are only
meaningful for the observation tier (a daily value cannot be subdivided —
daily rows pass through labeled `"daily"`); `daily` groups observations into
day buckets (drawn in the station's zone) while climatology rows pass
through; `monthly` groups everything into month buckets. If both tiers
produce the same daily bucket, the observation row wins (fresher, sample-based).

### Legacy route (Part 1): Antarctic stations

```
GET /api/antartida/datos/fechaini/{fechaIniStr}/fechafin/{fechaFinStr}/estacion/{identificacion}
```

Kept byte-for-byte compatible with Part 1: `identificacion` is still
`juan-carlos-i` or `gabriel-de-castilla`, and the response is the Part 1
dataset (no cache metadata). New consumers should use `/api/datos`.

### Health

```
GET /api/health   ->  200 {"status":"ok"}  |  503 {"status":"error"}
```

### Errors

Every error is a JSON envelope: `{"error": {"code": "...", "message": "..."}}`.

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `bad_request` | Invalid path/query parameters, unknown station (with details) |
| 404 | `not_found` | Unknown route |
| 404 | `no_data` | AEMET has no data for that station/range |
| 429 | `aemet_rate_limited` | Upstream rate limit hit |
| 502 | `aemet_invalid_api_key` | AEMET rejected the configured key (keys expire!) |
| 502/503 | `aemet_*` | Other upstream failures |
| 500 | `internal_error` | Unexpected server error (details logged, never leaked) |

## Design decisions (Part 2)

- **Read-through, not prefetch:** every range is served from SQLite; only
  chunks that are missing or no longer fresh trigger an upstream fetch. A
  background sync of all stations would itself be the "overloading the
  source API" the challenge forbids.
- **Freshness model:** AEMET products differ in when their data becomes
  immutable — observations roll off after ~24 h, daily climatology
  publishes with ~4 days of delay, the Antarctic product updates a few
  times per day. Each product therefore has a *mutability horizon* and a
  TTL. A chunk entirely older than the horizon is cached **forever**;
  chunks inside it re-fetch only after the TTL (15 min obs, 6 h
  climatology tail, 30 min antartida). Every successful fetch is recorded
  in `range_sync`, so staleness is auditable.
- **Stampede protection:** concurrent identical requests share one
  in-flight fetch (single-flight per chunk), and the total number of
  concurrent AEMET requests is capped (`AEMET_MAX_CONCURRENT`, default 3,
  well under the documented ~50 req/min limit; note each logical query
  costs two HTTP calls because of AEMET's envelope).
- **Serve-stale over hard failure:** an upstream error never wipes cached
  data; the response is served with `stale: true`. The cache exists
  precisely to survive AEMET outages during trading hours.
- **Two-tier honesty:** rows carry their `granularity` and `samples`
  because a daily mean and a 10-minute reading are different kinds of
  facts; the API never disguises one as the other.
- **Per-station aggregation timezone:** day/month boundaries are drawn in
  the station's own zone — the Canary Islands aggregate in
  `Atlantic/Canary`, the rest in `Europe/Madrid`, the Antarctic stations
  in UTC — while output datetimes are always Europe/Madrid with explicit
  CET/CEST offsets (Part 1 requirement, DST transitions pinned by tests).
- **Catalog:** synced from AEMET's station inventory at boot (daily
  refresh), with the two Antarctic stations embedded as a seed — they are
  **not** part of the upstream inventory (verified), and the seed also
  keeps the service usable when the inventory endpoint is down.

### Verified AEMET quirks (all pinned by live fixtures in tests)

- Every AEMET OpenData endpoint returns an envelope whose `datos` field is
  a URL to the actual data resource; the client follows it transparently.
- "No data" arrives as HTTP 200 with `estado: 404` inside the envelope.
- The antartida endpoint requires literal `UTC` date suffixes; missing
  measurements are the string `"NaN"`.
- Values may arrive as strings with decimal commas (`"14,2"`), numbers, or
  be absent — all normalized, never treated as zero.
- Conventional observations use `fint` timestamps with `+0000` offsets
  (no `Z`), and their cadence is station-dependent (hourly for 8178D).
- The station inventory is served as **latin-1**, decoded strictly
  (UTF-8 first, windows-1252 fallback) so names like "TÍAS" survive.
- Daily climatology queries are practically capped at ~10 days per
  request; longer ranges are split into consecutive windows and merged.
- Coordinates arrive as `ddmmss` + hemisphere strings (`"134125W"`).

## Project structure

```
src/
  config/          # env loading & validation, pino logger
  domain/          # stations, data types, time windows, coordinates, errors
  client/          # AEMET clients: antartida, climatology, obs, inventory,
                   #   + concurrency limiter (all quirks verified live)
  storage/         # SQLite: migrations, readings repo, station catalog repo
  services/        # time parsing/DST, aggregation, read-through product cache,
                   #   station catalog sync, two-tier composite dataset service
  routes/          # antartida route (Part 1), datos route (Part 2), health,
                   #   shared request parsing
  middleware/      # request logging, central error handler
  app.ts           # Express application factory (everything injected)
  server.ts        # bootstrap: wiring, catalog sync, graceful shutdown
tests/
  timeService, aggregationService, api (Part 1 — unchanged, still green)
  climatologyClient, obsClient, inventoryClient (live fixtures)
  coordinates, concurrencyLimiter
  readingsRepository, stationCatalog (throwaway SQLite per test)
  productCache (freshness, TTL, single-flight, serve-stale)
  stationDataService (two-tier merge, boundary semantics)
  datosApi (full HTTP stack, cache metadata contract, /health)
```

## Limitations / TODOs

- [ ] Single-process deployment (SQLite + in-process single-flight). The
      README of the challenge assumes internal usage; horizontal scaling
      would need a shared cache and cross-instance dedup.
- [ ] Catalog refresh is a plain interval; a pub/sub or admin endpoint
      could force-refresh on demand.
- [ ] No request rate limiting of our own API (consumers are internal).
- [ ] Part 3 (front-end) not started.
