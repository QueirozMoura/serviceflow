import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

export function registerSecurityPlugins(app: FastifyInstance): void {
  const allowedOrigins = env.CORS_ORIGIN.split(',').map((origin) => origin.trim());

  app.register(helmet);
  app.register(cors, {
    origin: allowedOrigins,
    // A sessao e transportada por cookie HttpOnly; o navegador so envia/aceita
    // o cookie em requisicoes cross-origin (frontend <> backend) com credentials.
    credentials: true,
  });
  app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
  });
}
