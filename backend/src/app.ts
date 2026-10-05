import Fastify, { type FastifyError } from 'fastify';
import { Prisma } from '@prisma/client';
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
    // Atras de um proxy reverso (nginx, plataformas de deploy) o IP real do
    // cliente chega em X-Forwarded-For. Sem trustProxy o rate limit usaria o
    // IP do proxy, compartilhando o limite entre todos os clientes.
    trustProxy: env.TRUST_PROXY,
  });
  app.decorateRequest('user', null);
  app.register(cookie);
  const authRepository = options.authRepository ?? new PrismaAuthRepository(prisma);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    // Identificadores malformados (ex.: UUID invalido em /:id) chegam ao Prisma e
    // retornam P2023. Isso e entrada invalida do cliente, nao falha do servidor.
    const isInvalidInput = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2023';
    const statusCode = isInvalidInput ? 400 : error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    const isServerError = statusCode >= 500;

    if (isServerError) {
      request.log.error({ err: error }, 'Unhandled request error');
    } else {
      request.log.info({ err: error }, 'Request rejected');
    }

    // Nunca expor detalhes internos (Prisma, stack) ao cliente.
    const message = isInvalidInput
      ? 'Invalid identifier'
      : isServerError && env.NODE_ENV === 'production'
        ? 'Internal server error'
        : error.message;
    const errorName = isServerError ? 'Internal Server Error' : isInvalidInput ? 'Bad Request' : error.name;

    return reply.status(statusCode).send({
      statusCode,
      error: errorName,
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
