# Wind Farm API — Part 1 + Part 2 + Part 3

A Node.js + TypeScript web API that retrieves historical weather data from
AEMET (the Spanish Meteorological Agency) for the Business Development team's
wind farm feasibility study — Part 1 for the two Spanish Antarctic stations,
Part 2 for **all ~926 AEMET stations** served through a **SQLite read-through
cache** with structured logging, and Part 3 (this iteration) a **React SPA**
to query the data in a table and charts.

## How to review each part (tag layout)

The challenge parts are cumulative, each marked with a tag on `master`:

| Tag | Contents |
|---|---|
| `part-1` | **Part 1 only** — the original Antarctic stations API |
| `part-2` | **Part 1 + Part 2** — adds the SQLite read-through cache and all stations |
| `part-3` *(tip of `master`)* | **Everything** — adds the React SPA front-end |

To see exactly what a part added, compare tags, e.g. `git diff part-1..part-2`
or `git diff part-2..part-3` (on GitHub:
[Part 2's changes](../../compare/part-1...part-2) or
[Part 3's changes](../../compare/part-2...part-3)).

Part 3 requirements covered:

- **Front-end service**: a React 19 + Vite + TypeScript SPA (`frontend/`)
  where the user picks any catalog station, a time range, an aggregation and
  data types, and reads the result as **small-multiple line charts** and a
  **sortable, paginated table**
- **Supporting endpoint**: `GET /api/estaciones` (searchable station catalog
  for the picker)
- **Cache honesty in the UI**: stale/partial chips, last-synced time, and
  per-row granularity (10-min observations vs. daily climatology) are
  surfaced, never hidden
- **Production wiring**: one process serves API + built SPA; `npm run dev:all`
  for development

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
| Tests | Vitest + Supertest (backend, zero network) · Vitest + Testing Library (frontend) |
| Front-end | React 19 + Vite + Recharts SPA in `frontend/` |
| Dev workflow | `tsx watch` (dev), `tsc` (build), `npm run dev:all` (API + SPA) |

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
   npm run dev        # API only, auto-reload: http://localhost:3000
   npm run dev:all    # API + front-end dev server: http://localhost:5173
   ```

   Or the production way (one process serves API **and** the built SPA):

   ```bash
   npm run build:all  # compiles the backend and bundles the SPA
   npm start          # http://localhost:3000 — API + front-end together
   ```

4. Run the tests (they never touch the real AEMET API):

   ```bash
   npm test           # backend suite
   npm --prefix frontend test   # front-end suite
   npm run test:all   # both
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

### Station catalog (Part 3, supports the front-end picker)

```
GET /api/estaciones?search=juan&limit=20
```

- `search` (optional) — case-insensitive substring over the station id,
  name, or province.
- `limit` (optional) — max results, 1–500, default 100 (keeps picker
  responses bounded; a `limit` that is not a positive integer is a
  `400 bad_request`).

```json
{
  "count": 1,
  "stations": [
    { "id": "89064", "name": "JUAN CARLOS I", "province": null,
      "latitude": -62.66, "longitude": -60.39 }
  ]
}
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

## Design decisions (Part 3 — front-end)

- **React 19 + Vite + TypeScript SPA** (`frontend/`): one language across
  the whole project, and the API contract is mirrored in typed interfaces
  (`frontend/src/api/contract.ts`) so the compiler catches drift.
- **Small multiples, never a dual axis:** the three measurements have
  incompatible units (°C / hPa / m/s), so each gets its own synced chart
  with its own unit — the #1 charting mistake (two y-scales on one plot)
  is avoided by construction.
- **Validated palette:** the series colors (temperature `#055C8A`,
  pressure `#1AA9C9`, speed `#5D8A40`) are the brand colors snapped to the
  nearest step that passes the dataviz six-checks validator (lightness
  band, chroma floor, CVD separation ≥8 ΔE, normal-vision ≥15 ΔE,
  contrast); the pressure cyan's contrast WARN is covered by direct chart
  titles and the table view. Status is never color-alone — every cache
  chip carries its label.
- **DST-correct by construction:** the default range is computed per
  endpoint in the offset in force on that date (`Intl`), and the table's
  datetime sort compares **instants**, so the repeated wall-clock hour of
  the DST fall-back orders correctly.
- **No client state library:** a small `useDataset` hook with
  `AbortController` (changing filters cancels the in-flight request) —
  one kind of query doesn't justify TanStack Query.
- **Honest granularity in the UI:** the table shows each row's tier
  (10 min vs. daily) and a status chip explains mixed-granularity
  responses, because a daily mean and a 10-minute reading are different
  kinds of facts.
- **Served by the API process in production:** `express.static` mounts
  `frontend/dist` only when it exists, so a backend-only checkout still
  boots cleanly.



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
                   #   estaciones route (Part 3), shared request parsing
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
  estacionesApi (Part 3 picker endpoint: search, limit, validation)

frontend/               # Part 3 SPA (React 19 + Vite + TypeScript)
  src/api/        # typed contract mirror + fetch client + query builder
  src/components/ # station picker, cache status, charts, table (+ helpers)
  src/hooks/      # useDataset (abortable), useStations (debounced search)
  src/lib/        # dates (default range, wall-time formatting), display labels
  src/App.tsx     # form state → query → results pipeline
  src/*.test.*    # unit tests per module + App smoke test
```

## Limitations / TODOs

- [ ] Single-process deployment (SQLite + in-process single-flight). The
      README of the challenge assumes internal usage; horizontal scaling
      would need a shared cache and cross-instance dedup.
- [ ] Catalog refresh is a plain interval; a pub/sub or admin endpoint
      could force-refresh on demand.
- [ ] No request rate limiting of our own API (consumers are internal).
- [ ] Front-end: dark mode (tokens are structured for it, but the steps
      must be re-validated against a dark surface, not auto-flipped).
- [ ] Front-end: the Recharts bundle is ~500 kB minified; code-splitting
      it (dynamic import) would improve first load.
- [ ] Front-end: a station map picker (lat/lon is already in the catalog
      endpoint response) would be a nice upgrade over the search box.
