# Wind Farm API — Part 1: A humble beginning

A Node.js + TypeScript web API that retrieves historical weather data from the
two Spanish Antarctic meteo stations (**Gabriel de Castilla** and
**Juan Carlos I**) through the [AEMET OpenData API](https://opendata.aemet.es/centrodedescargas/inicio),
for the Business Development team's wind farm feasibility study in Antarctica.

## Requirements covered

- Web service exposing the endpoint
  `GET /api/antartida/datos/fechaini/{fechaIniStr}/fechafin/{fechaFinStr}/estacion/{identificacion}`
- AEMET API key read from an environment variable (`.env`, never committed)
- Input datetimes in `YYYY-MM-DDTHH:MM:SS`, interpreted in an optional
  user-supplied **location** (IANA zone or fixed UTC offset; UTC by default)
- Only the two Antarctic stations are selectable
- **Time aggregation**: `none` (raw 10-minute series), `hourly`, `daily`, `monthly`
- **Data types**: `temperature` (°C), `pressure` (hPa), `speed` (m/s) —
  0 to 3 of them; zero (or omitted) means "all"
- Output `datetime` in **Europe/Madrid (CET/CEST)**, always including the
  offset (e.g. `2026-10-01T12:00:00+02:00`), with DST behaviour verified by tests
- Automated tests (unit + HTTP integration) and a clean git history

## Stack

| Concern | Choice |
|---|---|
| Language | TypeScript (strict mode), ESM |
| HTTP framework | Express 5 |
| Validation | Zod |
| Time zones / DST | Luxon |
| HTTP client | Native `fetch` |
| Tests | Vitest + Supertest |
| Dev workflow | `tsx watch` (dev), `tsc` (build) |

## Getting started

**Prerequisites:** Node.js ≥ 20 (developed on Node 26) and npm.

1. Get a free AEMET API key at
   <https://opendata.aemet.es/centrodedescargas/inicio>
   ⚠️ register with a **personal** e-mail account — corporate accounts are blocked.
2. Copy `.env.example` to `.env` and paste your key:

   ```
   AEMET_API_KEY=eyJhbGciOiJ...
   PORT=3000
   ```

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

4. Run the tests:

   ```bash
   npm test
   ```

   The suite never hits the real AEMET API — the client is injected and mocked.

## API reference

### Endpoint

```
GET /api/antartida/datos/fechaini/{fechaIniStr}/fechafin/{fechaFinStr}/estacion/{identificacion}
```

| Path parameter | Description |
|---|---|
| `fechaIniStr` | Start datetime, `YYYY-MM-DDTHH:MM:SS` |
| `fechaFinStr` | End datetime, `YYYY-MM-DDTHH:MM:SS` (must be after the start) |
| `identificacion` | `juan-carlos-i` or `gabriel-de-castilla` |

| Query parameter | Optional | Description |
|---|---|---|
| `location` | yes | Time zone the input datetimes are expressed in: an IANA name (e.g. `Europe/Berlin`) **or** a fixed UTC offset (e.g. `+02:00`). Defaults to UTC. |
| `aggregation` | yes | `none` (default), `hourly`, `daily`, `monthly` |
| `types` | yes | Comma-separated list of `temperature`, `pressure`, `speed`. Absent or empty means "all". |

### Examples

Raw 10-minute series, datetimes understood as UTC:

```bash
curl "http://localhost:3000/api/antartida/datos/fechaini/2026-01-01T00:00:00/fechafin/2026-01-02T00:00:00/estacion/juan-carlos-i"
```

Daily aggregation of wind speed and temperature, datetimes in Madrid local time:

```bash
curl "http://localhost:3000/api/antartida/datos/fechaini/2026-01-01T00:00:00/fechafin/2026-02-01T00:00:00/estacion/gabriel-de-castilla?location=Europe/Madrid&aggregation=daily&types=temperature,speed"
```

> **Note:** the stations operate during the Antarctic summer campaigns, so
> data is typically available roughly from November to March. Requesting a
> period with no measurements returns a `404 no_data` error.

Same request with an explicit offset instead of a zone name:

```bash
curl ".../estacion/gabriel-de-castilla?location=+02:00&aggregation=daily&types=temperature,speed"
```

### Response

```json
{
  "station": "Meteo Station Juan Carlos I",
  "stationId": "juan-carlos-i",
  "sourceStationName": "JUAN CARLOS I",
  "start": "2026-10-01T02:00:00+02:00",
  "end": "2026-10-02T02:00:00+02:00",
  "timezone": "Europe/Madrid",
  "aggregation": "hourly",
  "types": ["temperature", "pressure", "speed"],
  "count": 24,
  "data": [
    {
      "datetime": "2026-10-01T02:00:00+02:00",
      "samples": 6,
      "temperature": 1.35,
      "pressure": 986.5,
      "speed": 4.83
    }
  ]
}
```

- `datetime` is the start of the aggregation bucket (`none` → the raw
  10-minute timestamps), always in Europe/Madrid with the CET/CEST offset.
- `samples` tells how many 10-minute source readings were combined into the
  row (1 for `none`), so gaps in the source data are visible.
- Each value is the arithmetic **mean** of the valid samples in the bucket.
  Missing source values are skipped, never treated as zero; a data type with
  no samples in a bucket is `null`.
- Only the requested `types` appear as keys in the rows.

### Errors

Every error is a JSON envelope: `{"error": {"code": "...", "message": "..."}}`.

| HTTP | `code` | Meaning |
|---|---|---|
| 400 | `bad_request` | Invalid path/query parameters (with details) |
| 404 | `not_found` | Unknown route |
| 404 | `no_data` | AEMET has no data for that station/range |
| 429 | `aemet_rate_limited` | Upstream rate limit hit |
| 502 | `aemet_invalid_api_key` | AEMET rejected the configured key |
| 502/503 | `aemet_*` | Other upstream failures |
| 500 | `internal_error` | Unexpected server error (details logged, never leaked) |

## Design decisions

- **Layering:** `routes` (HTTP + validation) → `services` (time & aggregation
  logic, pure and unit-tested) → `client` (AEMET specifics) → `domain`
  (stations, data types, errors shared by all layers).
- **Dependency injection:** the app factory takes an `AemetReadingsFetcher`
  interface, so the full HTTP stack is tested without network access, and a
  caching layer (Part 2) can be added without touching routes or services.
- **AEMET two-step fetch:** every AEMET OpenData endpoint returns an envelope
  whose `datos` field is a URL to the actual data resource; the client follows
  it transparently.
- **Verified AEMET quirks** (all pinned by tests in `tests/aemetClient.test.ts`):
  the path dates require the literal `UTC` suffix (`...T00:00:00UTC`);
  "no data" arrives as HTTP 200 with `estado: 404` inside the envelope (mapped
  to our `404 no_data`); missing measurements are the string `"NaN"` (mapped
  to `null`); timestamps are ISO with `Z` suffix.
- **Station catalog:** the challenge's friendly station names map to the AEMET
  identifiers `89064` (Juan Carlos I) and `89070` (Gabriel de Castilla), taken
  from the official OpenData catalog. The catalog also carries the station's
  aggregation timezone.
- **Aggregation timezone:** day/month boundaries are drawn in the station's
  data timezone (AEMET publishes these stations in UTC; kept per-station and
  configurable in `src/domain/stations.ts`), while the output is rendered in
  Europe/Madrid as required. This keeps both requirements satisfied explicitly
  instead of implicitly.
- **DST:** all conversions use Luxon zone-aware datetimes. The test suite pins
  both Madrid transitions of 2026 (spring 2026-03-29 and autumn 2026-10-25),
  including the skipped hour and the ambiguous repeated hour.

## Project structure

```
src/
  config/          # env loading & validation (fails fast on bad config)
  domain/          # stations, data types, HTTP errors
  client/          # AemetClient (two-step fetch, upstream error mapping)
  services/        # time parsing/DST, aggregation, dataset assembly
  routes/          # endpoint definition + parameter validation
  middleware/      # central error handler
  app.ts           # Express application factory
  server.ts        # bootstrap (listen, graceful shutdown)
tests/
  timeService.test.ts        # input parsing & DST behaviour
  aggregationService.test.ts  # aggregation math & bucket boundaries
  api.test.ts                 # full HTTP stack with a mocked Aemet client
```

## Known limitations / TODOs

- [ ] No caching or storage of AEMET responses (that is Part 2).
- [ ] No request rate limiting of our own API (out of Part 1 scope).
