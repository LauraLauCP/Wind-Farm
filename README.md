# About this project

I developed this project as a technical assessment for an internship selection process. The internship would form part of the second year of my higher vocational training programme in Multi-platform Applications Development (DAM). The company is primarily focused on water management.

## Getting started

The prerequisites you will need are Node.js ≥ 20 version and npm.

1. Get a free AEMET API key at https://opendata.aemet.es/centrodedescargas/inicio
2. Register with a personal e-mail account, corporate accounts are blocked. Keys expire after 3 months, renew when upstream starts answering `aemet_invalid_api_key`.
3. Copy `.env.example` to `.env` and paste your key.
4. Install and run:

   ```bash
   npm install
   npm run dev        →  API only, auto-reload: http://localhost:3000
   npm run dev:all    →  API and frontend dev server: http://localhost:5173
   ```

5. Open another terminal to send requests to the API.

Or the production way (one process serves API and the built SPA):

```bash
npm run build:all  →  compiles the backend and bundles the SPA
npm start          →  http://localhost:3000 for API and frontend together
```

Run the tests (they never touch the real AEMET API):

```bash
npm test           →  backend suite
npm --prefix frontend test   →  front-end suite
npm run test:all   →  both
```

## Technology choices

Before diving into the implementation, I'd like to explain the main technology choices I made for this project and the reasoning behind them.

### AI-assisted development

I developed this project with AI assistance. Specifically, I used Claude Code as a coding agent, configured to use GLM 5.3 running on Ollama's cloud servers.

To stay actively involved in the decision-making process rather than simply accepting generated solutions, I also used two AI Hero skills:

- **"Grilling"**: to have the model ask me questions about important decisions, helping me explore the trade-offs and make my own informed choice.
- **"TDD"**: as a reference for writing tests before implementing the code needed to pass them.

### Test-driven development

I chose test-driven development (TDD) to support the challenge's testing requirements and keep the implementation focused on the expected behaviour. I used Vitest as the test runner and Supertest to test the API endpoints.

Writing tests first helped me clarify requirements and think through edge cases before implementing each feature. The resulting test suite also provides a way to check for regressions when changing or refactoring the code.

My aim was to build a codebase that is easier to maintain, extend, and document, with tests that describe how its main features are expected to behave.

### Node.js

I chose Node.js as the backend runtime so I could use TypeScript across both the backend and frontend and work within the same package ecosystem.

### TypeScript

I chose TypeScript for its static type checking and its suitability for a Node.js project. Compared with plain JavaScript, it helps catch issues such as incompatible assignments and unexpected function return types during development.

TypeScript also shares some familiar concepts with Java, which is the programming language I use most often.

### Express 5

I chose Express 5 as the backend web framework.

Fastify would also have been a reasonable option, but I opted for Express because of its flexibility, extensive documentation, and broad ecosystem. For this project, I wanted a framework that would let me organise the API clearly and extend it without introducing unnecessary complexity.

### React 19 and Vite

For the frontend, I chose a single-page application (SPA) built with React and TypeScript, using Vite for development and production builds.

React's component-based approach helped me divide the interface into small, reusable pieces and address the challenge's emphasis on code organisation.

### Project delivery

To make the implementation easier to review, I committed the entire project to the master branch of the GitHub repository and created three tags to mark each stage: `part-1`, `part-2`, and `part-3`.

### SQLite

As required by the challenge, I used SQLite to store data retrieved from the source API and avoid overloading it. SQLite provides a small, fast, self-contained SQL database engine.

## Part 1 - A humble beginning

### Important decisions and requirements

According to the API documentation, only two stations are available: Gabriel de Castilla and Juan Carlos I.

The supported time aggregation options are `none`, `hourly`, `daily`, and `monthly`.

The available data types are temperature, pressure, and speed. Users can select any combination of these three types; selecting none returns all three.

The source API provides data at 10-minute intervals.

Users can specify the following parameters:

- **Datetime Start** with format `(AAAA-MM-DDTHH:MM:SS)`.
- **Datetime End** with format `(AAAA-MM-DDTHH:MM:SS)`.
- **Location** (optional parameter) should indicate the location of the datetimes sent, or, alternatively, the time zone shift in the datetimes.

For this part, the following endpoint is required:

```
/api/antartida/datos/fechaini/{fechaIniStr}/fechafin/{fechaFinStr}/estacion/{identificacion}
```

### Checking the application's health

```bash
curl "http://localhost:3000/api/health"
```

### Retrieving data

```bash
curl "http://localhost:3000/api/antartida/datos/fechaini/2026-01-01T00:00:00/fechafin/2026-01-02T00:00:00/estacion/juan-carlos-i"
```

Gabriel de Castilla station:

```bash
curl "http://localhost:3000/api/antartida/datos/fechaini/2026-01-01T00:00:00/fechafin/2026-01-02T00:00:00/estacion/gabriel-de-castilla"
```

Gabriel de Castilla station using optional location parameter:

```bash
curl "http://localhost:3000/api/antartida/datos/fechaini/2026-01-01T00:00:00/fechafin/2026-01-02T00:00:00/estacion/gabriel-de-castilla?location=Europe/Madrid"
```

Gabriel de Castilla station using a UTC offset as the location value:

```bash
curl "http://localhost:3000/api/antartida/datos/fechaini/2026-01-01T00:00:00/fechafin/2026-01-02T00:00:00/estacion/gabriel-de-castilla?location=-05:30"
```

### Inspecting the response (Windows PowerShell)

```powershell
$base = "http://localhost:3000/api/antartida/datos/fechaini/2026-01-01T00:00:00/fechafin/2026-01-02T00:00:00/estacion/juan-carlos-i"

Invoke-RestMethod -Uri $base
```

### Filtering the returned measurements (Windows PowerShell)

All available measurements:

```powershell
(Invoke-RestMethod -Uri $base).data[0]
```

An empty types parameter also returns all available measurements:

```powershell
(Invoke-RestMethod -Uri "${base}?types=").data[0]
```

Only datetime, samples, and temperature:

```powershell
(Invoke-RestMethod -Uri "${base}?types=temperature").data[0]
```

Temperature and speed, without the pressure field:

```powershell
(Invoke-RestMethod -Uri "${base}?types=temperature,speed").data[0]
```

### Inspecting the response (Linux Bash)

These examples use `jq` to display and filter JSON. If it is not installed, you can install it on systems that use `apt` with: `sudo apt install jq`

```bash
curl "http://localhost:3000/api/antartida/datos/fechaini/2026-01-01T00:00:00/fechafin/2026-01-02T00:00:00/estacion/juan-carlos-i" | jq .
```

### Filtering the returned measurements (Linux Bash)

All available measurements:

```bash
curl "http://localhost:3000/api/antartida/datos/fechaini/2026-01-01T00:00:00/fechafin/2026-01-02T00:00:00/estacion/juan-carlos-i" | jq '.data[0]'
```

An empty types parameter also returns all available measurements:

```bash
curl "http://localhost:3000/api/antartida/datos/fechaini/2026-01-01T00:00:00/fechafin/2026-01-02T00:00:00/estacion/juan-carlos-i?types=" | jq '.data[0]'
```

Only datetime, samples, and temperature:

```bash
curl "http://localhost:3000/api/antartida/datos/fechaini/2026-01-01T00:00:00/fechafin/2026-01-02T00:00:00/estacion/juan-carlos-i?types=temperature" | jq '.data[0]'
```

Temperature and speed, without the pressure field:

```bash
curl "http://localhost:3000/api/antartida/datos/fechaini/2026-01-01T00:00:00/fechafin/2026-01-02T00:00:00/estacion/juan-carlos-i?types=temperature,speed" | jq '.data[0]'
```

### Confirming the behaviour during the Daylight-Saving Time (DST) (Linux Bash)

I used the Luxon library to work with dates and times.

I checked this using the Auckland time zone, which observes daylight saving time in January (NZDT, UTC+13:00):

```bash
curl "http://localhost:3000/api/antartida/datos/fechaini/2026-01-01T00:00:00/fechafin/2026-01-02T00:00:00/estacion/gabriel-de-castilla?location=Pacific/Auckland&aggregation=daily" | jq
```

## Part 2 - Traders discover the service

This part follows the same basic usage as part 1, with a few changes. Since this part does not specify a required endpoint path, I introduced a canonical route that makes it easier to identify stations by their IDs.

Juan Carlos I weather station, ID 89064:

```bash
curl "http://localhost:3000/api/datos/fechaini/2026-01-01T00:00:00/fechafin/2026-01-02T00:00:00/estacion/89064"
```

Gabriel de Castilla weather station, ID 89070:

```bash
curl "http://localhost:3000/api/datos/fechaini/2026-01-01T00:00:00/fechafin/2026-01-02T00:00:00/estacion/89070"
```

Clients only need to use the canonical `/api/datos/…` route. The original `/api/antartida/…` route remains available for backward compatibility because part 1 of the challenge explicitly requires it, and the existing tests verify that it continues to work.

The query parameters remain the same as in Part 1: datetime start, date time end, location, time aggregation, and types.

For example:

```bash
curl "http://localhost:3000/api/datos/fechaini/2026-01-01T00:00:00/fechafin/2026-02-01T00:00:00/estacion/89064?location=Europe/Madrid&aggregation=daily&types=temperature,speed"
```

### SQLite-backed data access

The API serves data from SQLite. If the requested time range is not cached, it fetches the missing data from AEMET, stores it, and then serves the response from the database.

The weather-data cache starts empty and grows as requests arrive.

I used `better-sqlite3` to interact with the SQLite database from Node.js.

### Station registry

The application synchronises the full station registry from AEMET's maestro endpoint into a SQLite table at startup and refreshes it periodically. Station identifiers are validated against this local registry.

The two Antarctic stations are included as fallback seed data, allowing the application to serve those stations even if the registry endpoint is unavailable at startup.

Keeping the registry locally also means that station lookups do not require a network request once the registry has been populated.

### Why I did not use an ORM

I decided not to use an ORM. With only two tables and a small set of prepared statements, I felt that adding one would introduce unnecessary complexity for a challenge that values clarity.

### Concurrency and upstream requests

I added a fetch queue with an environment-configurable concurrency limit and exponential backoff. This logic lives in the AEMET client layer so that all callers benefit from it.

The challenge requires the application to handle thousands of requests, so avoiding duplicate upstream calls was another important consideration.

If 50 clients request the same stale station data at the same time, the application should not send 50 identical requests to AEMET. Instead, the first request starts the fetch, while the others await the same promise and then read the updated data from SQLite.

### Availability and stale data

The challenge prioritises availability during business hours and states that AEMET updates its data a few times per day. I therefore treated access to cached data as more important than requiring a successful refresh for every request.

When cached data is stale and a refresh fails, the API still returns the stored data, with explicit metadata indicating its status. It returns an error only when no stored data is available to satisfy the request.

### Data granularity

- Based on my investigation of the available AEMET endpoints, I could not retrieve historical observations at 10-minute intervals for non-Antarctic stations. I therefore kept the Antarctic data product for the two Antarctic stations, providing 10-minute observations across the requested range, as in Part 1. For other stations, I used a two-tier approach:
  - **Recent data**: observations at 10-minute intervals, where available.
  - **Older data**: daily climatological records.
- The response identifies each row's granularity so that clients can distinguish between observation data and daily records.

### Logging

To address the requirement for logging that supports troubleshooting, I chose Pino, a logging library for Node.js. Rather than writing unstructured text messages, the application produces JSON logs containing a severity level and relevant contextual fields. This structure makes it easier to filter, search, and correlate events during troubleshooting.

I also wanted to keep logging overhead low while maintaining useful diagnostic information.

## Part 3 - A frontend for convenience

- The dataset can contain thousands of rows, so I added client-side pagination and sortable columns to make it easier to explore. The charting library I used was Recharts.
- The table shows each row's tier (10 min vs. daily) and a status chip explains mixed-granularity responses, because a daily mean and a 10-minute reading are different kinds of facts. The API never disguises one as the other.

For the interface and terminal colour palette, I used colours sampled from the company logo:

- Dark petrol blue (`#056080`) as the primary colour.
- Cyan (`#31ADC5`) as the secondary colour.
- Muted green (`#5D8A40`) for accents.

### How to use

1. Open a terminal in the `src` directory.
2. Start the application:

   ```bash
   npm run dev:all
   ```

3. Open the link shown in the terminal.

In this version, you can enter the required values and adjust the parameters more easily through the user interface.

The application notifies you if an error occurs or if the source API fails and cached data is used to answer your request.

## Project structure

```
src/
  config/     → env loading and validation, pino logger
  domain/     → stations, data types, time windows, coordinates, errors
  client/     → AEMET clients: antartida, climatology, obs, inventory,
              → concurrency limiter
  storage/    → SQLite: migrations, readings repo, station catalog repo
  services/   → time parsing/DST, aggregation, read-through product cache,
              → station catalog sync, two-tier composite dataset service
  routes/     → antartida route (Part 1), datos route (Part 2), health,
              → estaciones route (Part 3), shared request parsing
  middleware/ → request logging, central error handler
  app.ts      → Express application factory (everything injected)
  server.ts   → bootstrap: wiring, catalog sync, graceful shutdown

tests/
  timeService, aggregationService, api (part 1 unchanged)
  climatologyClient, obsClient, inventoryClient (live fixtures)
  coordinates, concurrencyLimiter
  readingsRepository, stationCatalog (throwaway SQLite per test)
  productCache (freshness, TTL, single-flight, serve-stale)
  stationDataService (two-tier merge, boundary semantics)
  datosApi (full HTTP stack, cache metadata contract, /health)
  estacionesApi (part 3 picker endpoint: search, limit, validation)

frontend/     → Part 3 SPA (React 19 + Vite + TypeScript)
  src/api/        → typed contract mirror + fetch client + query builder
  src/components/ → station picker, cache status, charts, table (+ helpers)
  src/hooks/      → useDataset (abortable), useStations (debounced search)
  src/lib/        → dates (default range, wall-time formatting), display labels
  src/App.tsx     → form state → query → results pipeline
  src/*.test.*    → unit tests per module + App smoke test
```

## Errors

I used Zod, a validation library, to validate request parameters and identify invalid input.

- 400 `bad_request` → Invalid path/query parameters, unknown station (with details)
- 404 `not_found` → Unknown route
- 404 `no_data` → AEMET has no data for that station/range
- 429 `aemet_rate_limited` → Upstream rate limit hit
- 502 `aemet_invalid_api_key` → AEMET rejected the configured key (keys expire!)
- 502/503 `aemet_*` → Other upstream failures
- 500 `internal_error` → Unexpected server error (details logged, never leaked)
