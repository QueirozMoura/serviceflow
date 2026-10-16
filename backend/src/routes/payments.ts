import { PaymentStatus } from '@prisma/client';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middlewares/authenticate.js';
import { authorize } from '../middlewares/authorize.js';
import type { AuthRepository } from '../modules/auth/repository.js';
import { PaymentExceedsBalanceError, PaymentIdempotencyConflictError, PaymentImmutableError, PaymentServiceOrderNotFoundError, PrismaPaymentRepository, type PaymentRepository } from '../modules/payments/repository.js';
import { idempotencyKeySchema } from '../modules/messages/schemas.js';
import { createPaymentSchema, paymentStatusQuerySchema, updatePaymentSchema, updatePaymentStatusSchema } from '../modules/payments/schemas.js';

type PaymentRoutesOptions = { authRepository?: AuthRepository; paymentRepository?: PaymentRepository; database?: PrismaClient };

function notFound(reply: FastifyReply) { return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Payment not found' }); }
function serviceOrderNotFound(reply: FastifyReply) { return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Service order not found' }); }
function exceedsBalance(reply: FastifyReply) { return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Payment amount exceeds the outstanding balance' }); }
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

  app.post('/:serviceOrderId/payments', { preHandler: [requireAuthentication, authorize('payments:write')] }, async (request, reply) => {
    const parsed = createPaymentSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid payment data' });
    // Idempotency-Key opcional: com ela, repetir a mesma requisicao devolve o pagamento original em vez de duplica-lo.
    const rawKey = request.headers['idempotency-key'];
    const keyResult = rawKey === undefined ? null : idempotencyKeySchema.safeParse(rawKey);
    if (keyResult && !keyResult.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid idempotency key' });
    const scope = await getScope(request, reply); if (!scope) return;
    try {
      const result = await repository.create(scope.organizationId, scope.serviceOrderId, parsed.data, keyResult?.success ? keyResult.data : undefined);
      return reply.status(result.created ? 201 : 200).send({ payment: result.payment });
    } catch (error) {
      if (error instanceof PaymentExceedsBalanceError) return exceedsBalance(reply);
      if (error instanceof PaymentIdempotencyConflictError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Idempotency key was already used with different data' });
      if (error instanceof PaymentServiceOrderNotFoundError) return serviceOrderNotFound(reply);
      throw error;
    }
  });

  app.get('/:serviceOrderId/payments', { preHandler: [requireAuthentication, authorize('payments:read')] }, async (request, reply) => {
    const scope = await getScope(request, reply); if (!scope) return;
    const parsed = paymentStatusQuerySchema.safeParse({ status: (request.query as { status?: string }).status });
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid payment filter' });
    return reply.send({ payments: await repository.list(scope.organizationId, scope.serviceOrderId, parsed.data.status) });
  });

  app.get('/:serviceOrderId/payments/:paymentId', { preHandler: [requireAuthentication, authorize('payments:read')] }, async (request, reply) => {
    const scope = await getScope(request, reply); if (!scope) return;
    const payment = await repository.findById(scope.organizationId, scope.serviceOrderId, (request.params as { paymentId: string }).paymentId);
    if (!payment) return notFound(reply);
    return reply.send({ payment });
  });

  app.patch('/:serviceOrderId/payments/:paymentId', { preHandler: [requireAuthentication, authorize('payments:write')] }, async (request, reply) => {
    const parsed = updatePaymentSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid payment data' });
    const scope = await getScope(request, reply); if (!scope) return;
    try {
      const payment = await repository.update(scope.organizationId, scope.serviceOrderId, (request.params as { paymentId: string }).paymentId, parsed.data);
      if (!payment) return notFound(reply);
      return reply.send({ payment });
    } catch (error) {
      if (error instanceof PaymentImmutableError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Payment is immutable' });
      if (error instanceof PaymentExceedsBalanceError) return exceedsBalance(reply);
      throw error;
    }
  });

  app.patch('/:serviceOrderId/payments/:paymentId/status', { preHandler: [requireAuthentication, authorize('payments:write')] }, async (request, reply) => {
    const parsed = updatePaymentStatusSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid payment status' });
    const scope = await getScope(request, reply); if (!scope) return;
    const payment = await repository.findById(scope.organizationId, scope.serviceOrderId, (request.params as { paymentId: string }).paymentId);
    if (!payment) return notFound(reply);
    if (!transitions[payment.status].includes(parsed.data.status)) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Invalid payment status transition' });
    return reply.send({ payment: await repository.updateStatus(scope.organizationId, scope.serviceOrderId, payment.id, parsed.data.status) });
  });

  app.delete('/:serviceOrderId/payments/:paymentId', { preHandler: [requireAuthentication, authorize('payments:delete')] }, async (request, reply) => {
    const scope = await getScope(request, reply); if (!scope) return;
    try {
      const deleted = await repository.delete(scope.organizationId, scope.serviceOrderId, (request.params as { paymentId: string }).paymentId);
      if (!deleted) return notFound(reply);
      return reply.status(204).send();
    } catch (error) { if (error instanceof PaymentImmutableError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Payment is immutable' }); throw error; }
  });
}