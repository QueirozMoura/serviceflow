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
import { DomainConflictError, FinancialChangeForbiddenError } from './modules/shared/lifecycle.js';
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
import { overviewRoutes } from './routes/overview.js';
import type { OverviewRepository } from './modules/overview/repository.js';
import type { TeamRepository } from './modules/team/repository.js';
import type { Writable } from 'node:stream';
import { OutboxMailer, createMailer, type Mailer } from './modules/mail/mailer.js';
import { PrismaPasswordResetRepository } from './modules/password-reset/repository.js';
import { PasswordRecoveryService } from './modules/password-reset/service.js';
import { passwordResetRoutes } from './routes/password-reset.js';
import { invitationRoutes, teamRoutes } from './routes/team.js';

export function buildApp(options: { authRepository?: AuthRepository; customerRepository?: CustomerRepository; equipmentRepository?: EquipmentRepository; serviceOrderRepository?: ServiceOrderRepository; diagnosisRepository?: DiagnosisRepository; quoteRepository?: QuoteRepository; paymentRepository?: PaymentRepository; warrantyRepository?: WarrantyRepository; dashboardRepository?: DashboardRepository; messageRepository?: MessageRepository; overviewRepository?: OverviewRepository; teamRepository?: TeamRepository; mailer?: Mailer; passwordRecovery?: PasswordRecoveryService; /** Apenas testes: captura os logs para verificar que nada sensivel e registrado. */ loggerStream?: Writable } = {}) {
  const app = Fastify({
    logger: options.loggerStream ? { level: 'trace', stream: options.loggerStream } : env.NODE_ENV !== 'test',
    // Atras de um proxy reverso (nginx, plataformas de deploy) o IP real do
    // cliente chega em X-Forwarded-For. Sem trustProxy o rate limit usaria o
    // IP do proxy, compartilhando o limite entre todos os clientes.
    trustProxy: env.TRUST_PROXY,
  });
  app.decorateRequest('user', null);
  app.register(cookie);
  const authRepository = options.authRepository ?? new PrismaAuthRepository(prisma);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    // Regras de negocio do ciclo de vida: conflito com o estado atual (409) ou falta de permissao financeira (403).
    if (error instanceof DomainConflictError) {
      request.log.info({ err: error }, 'Request rejected by a business rule');
      return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: error.message });
    }
    if (error instanceof FinancialChangeForbiddenError) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: error.message });
    }

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

  registerSecurityPlugins(app);
  app.register(healthRoutes, { prefix: '/api' });
  app.register(authRoutes, { prefix: '/api/auth', repository: authRepository });
  const mailer = options.mailer ?? createMailer(env);
  const passwordRecovery = options.passwordRecovery ?? new PasswordRecoveryService({
    repository: new PrismaPasswordResetRepository(prisma),
    mailer,
    appBaseUrl: env.APP_BASE_URL ?? env.CORS_ORIGIN.split(',')[0]?.trim() ?? 'http://localhost:3000',
  });
  app.addHook('onReady', async () => {
    if (env.NODE_ENV === 'production' && !mailer.enabled) app.log.warn('MAIL_PROVIDER is not configured: password recovery e-mails will not be sent');
  });
  app.addHook('onClose', async () => { await passwordRecovery.idle(); });
  app.register(passwordResetRoutes, { prefix: '/api/auth/password', service: passwordRecovery });
  // Somente desenvolvimento (o ambiente recusa MAIL_PROVIDER=outbox em producao): permite ver o link sem enviar e-mail.
  if (mailer instanceof OutboxMailer && env.NODE_ENV !== 'production') app.get('/api/dev/mail-outbox', async () => ({ messages: mailer.messages }));
  app.register(invitationRoutes, { prefix: '/api/auth/invitations', teamRepository: options.teamRepository });
  app.register(teamRoutes, { prefix: '/api/team', authRepository, teamRepository: options.teamRepository });
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
  app.register(overviewRoutes, {
    prefix: '/api',
    authRepository,
    overviewRepository: options.overviewRepository,
  });
  app.register(messageRoutes, {
    prefix: '/api/service-orders',
    authRepository,
    messageRepository: options.messageRepository,
  });

  return app;
}
