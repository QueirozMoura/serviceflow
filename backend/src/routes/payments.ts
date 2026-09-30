import { PaymentStatus } from '@prisma/client';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middlewares/authenticate.js';
import type { AuthRepository } from '../modules/auth/repository.js';
import { PaymentImmutableError, PrismaPaymentRepository, type PaymentRepository } from '../modules/payments/repository.js';
import { createPaymentSchema, paymentStatusQuerySchema, updatePaymentSchema, updatePaymentStatusSchema } from '../modules/payments/schemas.js';

type PaymentRoutesOptions = { authRepository?: AuthRepository; paymentRepository?: PaymentRepository; database?: PrismaClient };

function notFound(reply: FastifyReply) { return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Payment not found' }); }
function serviceOrderNotFound(reply: FastifyReply) { return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Service order not found' }); }
const transitions: Record<PaymentStatus, PaymentStatus[]> = { PENDING: [PaymentStatus.PAID, PaymentStatus.FAILED, PaymentStatus.CANCELLED], PAID: [PaymentStatus.REFUNDED], FAILED: [], CANCELLED: [], REFUNDED: [] };

export async function paymentRoutes(app: FastifyInstance, options: PaymentRoutesOptions = {}): Promise<void> {
  const repository = options.paymentRepository ?? new PrismaPaymentRepository(options.database ?? prisma);
  if (!options.authRepository) throw new Error('Payment routes require an auth repository');
  const requireAuthentication = authenticate(options.authRepository);

  const getScope = async (request: { user: { organizationId: string } | null; params: unknown }, reply: FastifyReply) => {
    if (!request.user) { reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' }); return null; }
    const serviceOrderId = (request.params as { serviceOrderId: string }).serviceOrderId;
    if (!(await repository.serviceOrderBelongsToOrganization(request.user.organizationId, serviceOrderId))) { serviceOrderNotFound(reply); return null; }
    return { organizationId: request.user.organizationId, serviceOrderId };
  };

  app.post('/:serviceOrderId/payments', { preHandler: requireAuthentication }, async (request, reply) => {
    const parsed = createPaymentSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid payment data' });
    const scope = await getScope(request, reply); if (!scope) return;
    return reply.status(201).send({ payment: await repository.create(scope.organizationId, scope.serviceOrderId, parsed.data) });
  });

  app.get('/:serviceOrderId/payments', { preHandler: requireAuthentication }, async (request, reply) => {
    const scope = await getScope(request, reply); if (!scope) return;
    const parsed = paymentStatusQuerySchema.safeParse({ status: (request.query as { status?: string }).status });
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid payment filter' });
    return reply.send({ payments: await repository.list(scope.organizationId, scope.serviceOrderId, parsed.data.status) });
  });

  app.get('/:serviceOrderId/payments/:paymentId', { preHandler: requireAuthentication }, async (request, reply) => {
    const scope = await getScope(request, reply); if (!scope) return;
    const payment = await repository.findById(scope.organizationId, scope.serviceOrderId, (request.params as { paymentId: string }).paymentId);
    if (!payment) return notFound(reply);
    return reply.send({ payment });
  });

  app.patch('/:serviceOrderId/payments/:paymentId', { preHandler: requireAuthentication }, async (request, reply) => {
    const parsed = updatePaymentSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid payment data' });
    const scope = await getScope(request, reply); if (!scope) return;
    try {
      const payment = await repository.update(scope.organizationId, scope.serviceOrderId, (request.params as { paymentId: string }).paymentId, parsed.data);
      if (!payment) return notFound(reply);
      return reply.send({ payment });
    } catch (error) { if (error instanceof PaymentImmutableError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Payment is immutable' }); throw error; }
  });

  app.patch('/:serviceOrderId/payments/:paymentId/status', { preHandler: requireAuthentication }, async (request, reply) => {
    const parsed = updatePaymentStatusSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid payment status' });
    const scope = await getScope(request, reply); if (!scope) return;
    const payment = await repository.findById(scope.organizationId, scope.serviceOrderId, (request.params as { paymentId: string }).paymentId);
    if (!payment) return notFound(reply);
    if (!transitions[payment.status].includes(parsed.data.status)) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Invalid payment status transition' });
    return reply.send({ payment: await repository.updateStatus(scope.organizationId, scope.serviceOrderId, payment.id, parsed.data.status) });
  });

  app.delete('/:serviceOrderId/payments/:paymentId', { preHandler: requireAuthentication }, async (request, reply) => {
    const scope = await getScope(request, reply); if (!scope) return;
    try {
      const deleted = await repository.delete(scope.organizationId, scope.serviceOrderId, (request.params as { paymentId: string }).paymentId);
      if (!deleted) return notFound(reply);
      return reply.status(204).send();
    } catch (error) { if (error instanceof PaymentImmutableError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Payment is immutable' }); throw error; }
  });
}