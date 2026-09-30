import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:3000'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW: z.string().min(1).default('1 minute'),
  AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  AUTH_COOKIE_NAME: z.string().regex(/^[a-zA-Z0-9_-]+$/).default('serviceflow_session'),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment configuration:', result.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const env = result.data;
export type Env = typeof env;
