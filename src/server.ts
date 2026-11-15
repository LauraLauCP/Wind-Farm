import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { createApp } from './app.js';
import { AemetClient } from './client/aemetClient.js';
import { ConventionalObsClient } from './client/obsClient.js';
import { ClimatologyClient } from './client/climatologyClient.js';
import { AemetInventoryClient } from './client/inventoryClient.js';
import { withConcurrencyLimit } from './client/concurrencyLimiter.js';
import { ReadingsRepository } from './storage/readingsRepository.js';
import { StationCatalogRepository } from './storage/stationCatalogRepository.js';
import { CatalogService } from './services/stationCatalog.js';
import { StationDataService } from './services/stationDataService.js';

// --- Part 2 wiring: SQLite cache, catalog, concurrency-capped sources ---
mkdirSync(dirname(env.DB_PATH), { recursive: true });
const readingsRepo = new ReadingsRepository(env.DB_PATH);
const catalogRepo = new StationCatalogRepository(env.DB_PATH);

const antartidaClient = new AemetClient();
const obsClient = new ConventionalObsClient();
const climatologyClient = new ClimatologyClient();

// Q6: cap concurrent upstream requests so bursts of cache misses cannot
// overrun AEMET's free-key rate limit (~50 req/min, 2 HTTP calls per query).
const sources = {
  antartida: withConcurrencyLimit(env.AEMET_MAX_CONCURRENT, (start: import('luxon').DateTime, end: import('luxon').DateTime, id: string) =>
    antartidaClient.fetchReadings(start, end, id)),
  observations: withConcurrencyLimit(env.AEMET_MAX_CONCURRENT, (id: string) => obsClient.fetchObservations(id)),
  climatology: withConcurrencyLimit(env.AEMET_MAX_CONCURRENT, (start: import('luxon').DateTime, end: import('luxon').DateTime, id: string) =>
    climatologyClient.fetchDaily(start, end, id)),
};

const stationDataService = new StationDataService(readingsRepo, sources);
const catalogService = new CatalogService(catalogRepo, new AemetInventoryClient());

const app = createApp(antartidaClient, { catalogRepo, readingsRepo, stationDataService });

// Q3: sync the station catalog at boot and refresh daily; a failing sync
// never blocks startup (seeds + previous catalog remain available).
void catalogService.sync();
const catalogRefreshTimer = setInterval(() => {
  void catalogService.sync();
}, 24 * 60 * 60 * 1000);
catalogRefreshTimer.unref?.();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, dbPath: env.DB_PATH }, 'Wind Farm API listening');
  logger.info(`Try: http://localhost:${env.PORT}/api/datos/fechaini/2026-11-01T00:00:00/fechafin/2026-11-15T12:00:00/estacion/8178D`);
  logger.info(`And: http://localhost:${env.PORT}/api/antartida/datos/fechaini/2026-01-01T00:00:00/fechafin/2026-01-02T00:00:00/estacion/juan-carlos-i`);
});

function shutdown(signal: string): void {
  logger.info(`${signal} received — shutting down.`);
  clearInterval(catalogRefreshTimer);
  server.close(() => {
    readingsRepo.close();
    catalogRepo.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
