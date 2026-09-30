import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import { env } from './config/env.js';
import { registerSecurityPlugins } from './plugins/security.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import type { AuthRepository } from './modules/auth/repository.js';

export function buildApp(options: { authRepository?: AuthRepository } = {}) {
  const app = Fastify({
    logger: env.NODE_ENV !== 'test',
  });
  app.decorateRequest('user', null);
  app.register(cookie);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    request.log.error({ err: error }, 'Unhandled request error');

    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    const message = env.NODE_ENV === 'production' && statusCode >= 500 ? 'Internal server error' : error.message;

    return reply.status(statusCode).send({
      statusCode,
      error: statusCode >= 500 ? 'Internal Server Error' : error.name,
      message,
    });
  });

  app.register(registerSecurityPlugins);
  app.register(healthRoutes, { prefix: '/api' });
  app.register(authRoutes, { prefix: '/api/auth', repository: options.authRepository });

  return app;
}
