import type { FastifyInstance, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middlewares/authenticate.js';
import { authorize, ensurePermission } from '../middlewares/authorize.js';
import type { AuthRepository } from '../modules/auth/repository.js';
import { quoteStatusPermission } from '../modules/auth/permissions.js';
import { PrismaQuoteRepository, QuoteAlreadyExistsError, QuoteInUseError, QuoteNotFoundError, QuoteTransitionError, QUOTE_TRANSITIONS, type QuoteRepository } from '../modules/quotes/repository.js';
import { hasPermission } from '../modules/auth/permissions.js';
import { DueValueBelowReservedError } from '../modules/shared/due-value.js';
import { createQuoteSchema, createServiceItemSchema, updateQuoteSchema, updateQuoteStatusSchema, updateServiceItemSchema } from '../modules/quotes/schemas.js';

type QuoteRoutesOptions = { authRepository?: AuthRepository; quoteRepository?: QuoteRepository; database?: PrismaClient };

function notFound(reply: FastifyReply) { return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Quote not found' }); }
function belowReserved(reply: FastifyReply) { return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'The change would leave active payments above the amount due' }); }
function serviceOrderNotFound(reply: FastifyReply) { return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Service order not found' }); }

export async function quoteRoutes(app: FastifyInstance, options: QuoteRoutesOptions = {}): Promise<void> {
  const repository = options.quoteRepository ?? new PrismaQuoteRepository(options.database ?? prisma);
  if (!options.authRepository) throw new Error('Quote routes require an auth repository');
  const requireAuthentication = authenticate(options.authRepository);

  const getScope = async (request: { user: { organizationId: string } | null; params: unknown }, reply: FastifyReply) => {
    if (!request.user) { reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' }); return null; }
    const serviceOrderId = (request.params as { serviceOrderId: string }).serviceOrderId;
    if (!(await repository.serviceOrderBelongsToOrganization(request.user.organizationId, serviceOrderId))) { serviceOrderNotFound(reply); return null; }
    return { organizationId: request.user.organizationId, serviceOrderId };
  };

  app.post('/:serviceOrderId/quote', { preHandler: [requireAuthentication, authorize('quotes:write')] }, async (request, reply) => {
    const parsed = createQuoteSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid quote data' });
    const scope = await getScope(request, reply); if (!scope) return;
    try { return reply.status(201).send({ quote: await repository.create(scope.organizationId, scope.serviceOrderId, parsed.data) }); }
    catch (error) { if (error instanceof QuoteAlreadyExistsError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Quote already exists' }); if (error instanceof QuoteNotFoundError) return serviceOrderNotFound(reply); throw error; }
  });

  app.get('/:serviceOrderId/quote', { preHandler: [requireAuthentication, authorize('quotes:read')] }, async (request, reply) => {
    const scope = await getScope(request, reply); if (!scope) return;
    const quote = await repository.findByServiceOrder(scope.organizationId, scope.serviceOrderId);
    if (!quote) return notFound(reply);
    return reply.send({ quote });
  });

  app.patch('/:serviceOrderId/quote', { preHandler: [requireAuthentication, authorize('quotes:write')] }, async (request, reply) => {
    const parsed = updateQuoteSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid quote data' });
    const scope = await getScope(request, reply); if (!scope) return;
    const quote = await repository.update(scope.organizationId, scope.serviceOrderId, parsed.data);
    if (!quote) return notFound(reply);
    return reply.send({ quote });
  });

  app.patch('/:serviceOrderId/quote/status', { preHandler: [requireAuthentication, authorize('quotes:write')] }, async (request, reply) => {
    const parsed = updateQuoteStatusSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid quote status' });
    // Aprovar/rejeitar exige permissao propria; checado antes de consultar a OS/orcamento (sem vazar existencia).
    if (!ensurePermission(request, reply, quoteStatusPermission(parsed.data.status))) return reply;
    const scope = await getScope(request, reply); if (!scope || !request.user) return;
    const current = await repository.findByServiceOrder(scope.organizationId, scope.serviceOrderId);
    if (!current) return notFound(reply);
    if (!QUOTE_TRANSITIONS[current.status].includes(parsed.data.status)) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Invalid quote status transition' });
    try {
      const updated = await repository.updateStatus(scope.organizationId, scope.serviceOrderId, parsed.data.status, { userId: request.user.id, advanceServiceOrder: hasPermission(request.user.role, 'serviceOrders:approve') });
      if (!updated) return notFound(reply);
      return reply.send({ quote: updated });
    } catch (error) {
      if (error instanceof QuoteTransitionError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Invalid quote status transition' });
      if (error instanceof DueValueBelowReservedError) return belowReserved(reply);
      throw error;
    }
  });

  app.delete('/:serviceOrderId/quote', { preHandler: [requireAuthentication, authorize('quotes:delete')] }, async (request, reply) => {
    const scope = await getScope(request, reply); if (!scope) return;
    try { const deleted = await repository.delete(scope.organizationId, scope.serviceOrderId); if (!deleted) return notFound(reply); return reply.status(204).send(); }
    catch (error) { if (error instanceof QuoteInUseError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Quote has related items' }); throw error; }
  });

  app.post('/:serviceOrderId/quote/items', { preHandler: [requireAuthentication, authorize('quotes:price')] }, async (request, reply) => {
    const parsed = createServiceItemSchema.safeParse(request.body); if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid service item data' });
    const scope = await getScope(request, reply); if (!scope) return;
    try { return reply.status(201).send({ quote: await repository.addItem(scope.organizationId, scope.serviceOrderId, parsed.data) }); }
    catch (error) { if (error instanceof QuoteNotFoundError) return notFound(reply); if (error instanceof DueValueBelowReservedError) return belowReserved(reply); throw error; }
  });

  app.patch('/:serviceOrderId/quote/items/:itemId', { preHandler: [requireAuthentication, authorize('quotes:write')] }, async (request, reply) => {
    const parsed = updateServiceItemSchema.safeParse(request.body); if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid service item data' });
    // Preco e quantidade mudam o total do orcamento: exigem quotes:price (descricao e tipo, so quotes:write).
    if (!ensurePermission(request, reply, 'unitPrice' in parsed.data || 'quantity' in parsed.data ? 'quotes:price' : null)) return reply;
    const scope = await getScope(request, reply); if (!scope) return;
    try {
      const quote = await repository.updateItem(scope.organizationId, scope.serviceOrderId, (request.params as { itemId: string }).itemId, parsed.data);
      if (!quote) return notFound(reply);
      return reply.send({ quote });
    } catch (error) { if (error instanceof DueValueBelowReservedError) return belowReserved(reply); throw error; }
  });

  app.delete('/:serviceOrderId/quote/items/:itemId', { preHandler: [requireAuthentication, authorize('quotes:price')] }, async (request, reply) => {
    const scope = await getScope(request, reply); if (!scope) return;
    try {
      const quote = await repository.deleteItem(scope.organizationId, scope.serviceOrderId, (request.params as { itemId: string }).itemId);
      if (!quote) return notFound(reply);
      return reply.send({ quote });
    } catch (error) { if (error instanceof DueValueBelowReservedError) return belowReserved(reply); throw error; }
  });
}