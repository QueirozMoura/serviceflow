import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import { env } from './config/env.js';
import { prisma } from './lib/prisma.js';
import { PrismaAuthRepository, type AuthRepository } from './modules/auth/repository.js';
import type { CustomerRepository } from './modules/customers/repository.js';
import type { EquipmentRepository } from './modules/equipment/repository.js';
import type { ServiceOrderRepository } from './modules/service-orders/repository.js';
import type { DiagnosisRepository } from './modules/diagnosis/repository.js';
import type { QuoteRepository } from './modules/quotes/repository.js';
import type { PaymentRepository } from './modules/payments/repository.js';
import type { WarrantyRepository } from './modules/warranties/repository.js';
import type { DashboardRepository } from './modules/dashboard/repository.js';
import type { MessageRepository } from './modules/messages/repository.js';
import { registerSecurityPlugins } from './plugins/security.js';
import { authRoutes } from './routes/auth.js';
import { customerRoutes } from './routes/customers.js';
import { equipmentRoutes } from './routes/equipment.js';
import { serviceOrderRoutes } from './routes/service-orders.js';
import { diagnosisRoutes } from './routes/diagnosis.js';
import { quoteRoutes } from './routes/quotes.js';
import { paymentRoutes } from './routes/payments.js';
import { warrantyRoutes } from './routes/warranties.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { messageRoutes } from './routes/messages.js';
import { healthRoutes } from './routes/health.js';

export function buildApp(options: { authRepository?: AuthRepository; customerRepository?: CustomerRepository; equipmentRepository?: EquipmentRepository; serviceOrderRepository?: ServiceOrderRepository; diagnosisRepository?: DiagnosisRepository; quoteRepository?: QuoteRepository; paymentRepository?: PaymentRepository; warrantyRepository?: WarrantyRepository; dashboardRepository?: DashboardRepository; messageRepository?: MessageRepository } = {}) {
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
  app.register(serviceOrderRoutes, {
    prefix: '/api/service-orders',
    authRepository,
    serviceOrderRepository: options.serviceOrderRepository,
  });
  app.register(diagnosisRoutes, {
    prefix: '/api/service-orders',
    authRepository,
    diagnosisRepository: options.diagnosisRepository,
  });
  app.register(quoteRoutes, {
    prefix: '/api/service-orders',
    authRepository,
    quoteRepository: options.quoteRepository,
  });
  app.register(paymentRoutes, {
    prefix: '/api/service-orders',
    authRepository,
    paymentRepository: options.paymentRepository,
  });
  app.register(warrantyRoutes, {
    prefix: '/api/service-orders',
    authRepository,
    warrantyRepository: options.warrantyRepository,
  });
  app.register(dashboardRoutes, {
    prefix: '/api/dashboard',
    authRepository,
    dashboardRepository: options.dashboardRepository,
  });
  app.register(messageRoutes, {
    prefix: '/api/service-orders',
    authRepository,
    messageRepository: options.messageRepository,
  });

  return app;
}
