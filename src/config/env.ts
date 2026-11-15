import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  /** AEMET OpenData API key (https://opendata.aemet.es). Required. */
  AEMET_API_KEY: z.string().min(1, 'AEMET_API_KEY is required. Copy .env.example to .env and set your key.'),
  /** Base URL of the AEMET OpenData API. Configurable for tests/other environments. */
  AEMET_BASE_URL: z.string().min(1).default('https://opendata.aemet.es/opendata/api'),
  /** Port our HTTP server listens on. */
  PORT: z.coerce.number().int().positive().default(3000),
  /** Path of the SQLite cache database (Q12: single-process deployment). */
  DB_PATH: z.string().min(1).default('./data/windfarm.sqlite'),
  /** Log level (pino): 'trace' | 'debug' | 'info' | 'warn' | 'error'. */
  LOG_LEVEL: z.string().min(1).default('info'),
  /** Max concurrent upstream AEMET requests (Q6: backpressure). */
  AEMET_MAX_CONCURRENT: z.coerce.number().int().positive().default(3),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

/** Application settings, loaded and validated once at startup (fails fast on bad config). */
export const env = loadEnv();
