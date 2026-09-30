import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

export async function registerSecurityPlugins(app: FastifyInstance): Promise<void> {
  const allowedOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim());

  await app.register(helmet);
  await app.register(cors, {
    origin: allowedOrigins,
  });
  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
  });
}
