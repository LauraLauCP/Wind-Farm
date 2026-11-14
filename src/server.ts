import { env } from './config/env.js';
import { createApp } from './app.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  console.log(`Wind Farm API listening on http://localhost:${env.PORT}`);
  console.log(
    `Try: http://localhost:${env.PORT}/api/antartida/datos/fechaini/2026-10-01T00:00:00/fechafin/2026-10-02T00:00:00/estacion/juan-carlos-i`,
  );
});

function shutdown(signal: string): void {
  console.log(`${signal} received — shutting down.`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
