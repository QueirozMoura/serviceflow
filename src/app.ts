import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { PrismaAuthRepository, type AuthRepository } from './modules/auth/repository.js';
import type { CustomerRepository } from './modules/customers/repository.js';
import type { EquipmentRepository } from './modules/equipment/repository.js';
import { registerSecurityPlugins } from './plugins/security.js';
import { authRoutes } from './routes/auth.js';
import { customerRoutes } from './routes/customers.js';
import { equipmentRoutes } from './routes/equipment.js';
import { healthRoutes } from './routes/health.js';

export function buildApp(options: { authRepository?: AuthRepository; customerRepository?: CustomerRepository; equipmentRepository?: EquipmentRepository } = {}) {
  const app = Fastify({
    logger: env.NODE_ENV !== 'test',
  });
  app.decorateRequest('user', null);
  app.register(cookie);
  const authRepository = options.authRepository ?? new PrismaAuthRepository(prisma);

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
  app.register(authRoutes, { prefix: '/api/auth', repository: authRepository });
  app.register(customerRoutes, {
    prefix: '/api/customers',
    authRepository,
    customerRepository: options.customerRepository,
  });
  app.register(equipmentRoutes, {
    prefix: '/api/equipment',
    authRepository,
    equipmentRepository: options.equipmentRepository,
  });

  return app;
}
