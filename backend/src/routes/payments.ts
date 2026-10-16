import type { FastifyInstance, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middlewares/authenticate.js';
import { authorize } from '../middlewares/authorize.js';
import type { AuthRepository } from '../modules/auth/repository.js';
import { PAYMENT_TRANSITIONS, PaymentDueAmountUnknownError, PaymentExceedsBalanceError, PaymentTransitionError, PaymentIdempotencyConflictError, PaymentImmutableError, PaymentServiceOrderNotFoundError, PrismaPaymentRepository, type PaymentRepository } from '../modules/payments/repository.js';
import { idempotencyKeySchema } from '../modules/messages/schemas.js';
import { createPaymentSchema, paymentStatusQuerySchema, updatePaymentSchema, updatePaymentStatusSchema } from '../modules/payments/schemas.js';

type PaymentRoutesOptions = { authRepository?: AuthRepository; paymentRepository?: PaymentRepository; database?: PrismaClient };

function notFound(reply: FastifyReply) { return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Payment not found' }); }
function serviceOrderNotFound(reply: FastifyReply) { return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Service order not found' }); }
function dueUnknown(reply: FastifyReply) { return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'The amount due is not defined: set the service order final value or an active quote total first' }); }
function invalidTransition(reply: FastifyReply) { return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Invalid payment status transition' }); }
function exceedsBalance(reply: FastifyReply) { return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Payment amount exceeds the outstanding balance' }); }

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
    // Idempotency-Key obrigatoria: repetir a mesma requisicao devolve o pagamento original em vez de duplica-lo.
    const keyResult = idempotencyKeySchema.safeParse(request.headers['idempotency-key']);
    if (!keyResult.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'A valid Idempotency-Key header is required' });
    const scope = await getScope(request, reply); if (!scope) return;
    try {
      const result = await repository.create(scope.organizationId, scope.serviceOrderId, parsed.data, keyResult.data);
      return reply.status(result.created ? 201 : 200).send({ payment: result.payment });
    } catch (error) {
      if (error instanceof PaymentExceedsBalanceError) return exceedsBalance(reply);
      if (error instanceof PaymentDueAmountUnknownError) return dueUnknown(reply);
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
      if (error instanceof PaymentDueAmountUnknownError) return dueUnknown(reply);
      throw error;
    }
  });

  app.patch('/:serviceOrderId/payments/:paymentId/status', { preHandler: [requireAuthentication, authorize('payments:write')] }, async (request, reply) => {
    const parsed = updatePaymentStatusSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid payment status' });
    const scope = await getScope(request, reply); if (!scope) return;
    const payment = await repository.findById(scope.organizationId, scope.serviceOrderId, (request.params as { paymentId: string }).paymentId);
    if (!payment) return notFound(reply);
    if (!PAYMENT_TRANSITIONS[payment.status].includes(parsed.data.status)) return invalidTransition(reply);
    try {
      const updated = await repository.updateStatus(scope.organizationId, scope.serviceOrderId, payment.id, parsed.data.status);
      if (!updated) return notFound(reply);
      return reply.send({ payment: updated });
    } catch (error) { if (error instanceof PaymentTransitionError) return invalidTransition(reply); throw error; }
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