import ms from 'ms';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL: z.string().default('30d'),
  BOOTSTRAP_TOKEN: z.string().min(16),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(10).default(100),
});

export type RawConfig = z.infer<typeof envSchema>;

export interface AppConfig extends RawConfig {
  REFRESH_TOKEN_TTL_MS: number;
}

function parseDuration(duration: string, field: string): number {
  const parsed = ms(duration);
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid duration for ${field}: "${duration}"`);
  }
  return parsed;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(source);
  return {
    ...parsed,
    REFRESH_TOKEN_TTL_MS: parseDuration(parsed.REFRESH_TOKEN_TTL, 'REFRESH_TOKEN_TTL'),
  };
}
