import Fastify, { type FastifyError } from 'fastify';
import { env } from './config/env.js';
import { registerSecurityPlugins } from './plugins/security.js';
import { healthRoutes } from './routes/health.js';

export function buildApp() {
  const app = Fastify({
    logger: env.NODE_ENV !== 'test',
  });

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

  return app;
}
