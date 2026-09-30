import { QuoteStatus } from '@prisma/client';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middlewares/authenticate.js';
import type { AuthRepository } from '../modules/auth/repository.js';
import { PrismaQuoteRepository, QuoteAlreadyExistsError, QuoteInUseError, QuoteNotFoundError, type QuoteRepository } from '../modules/quotes/repository.js';
import { createQuoteSchema, createServiceItemSchema, updateQuoteSchema, updateQuoteStatusSchema, updateServiceItemSchema } from '../modules/quotes/schemas.js';

type QuoteRoutesOptions = { authRepository?: AuthRepository; quoteRepository?: QuoteRepository; database?: PrismaClient };

function notFound(reply: FastifyReply) { return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Quote not found' }); }
function serviceOrderNotFound(reply: FastifyReply) { return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Service order not found' }); }
const transitions: Record<QuoteStatus, QuoteStatus[]> = { PENDING: [QuoteStatus.APPROVED, QuoteStatus.REJECTED, QuoteStatus.EXPIRED], APPROVED: [], REJECTED: [], EXPIRED: [] };

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

  app.post('/:serviceOrderId/quote', { preHandler: requireAuthentication }, async (request, reply) => {
    const parsed = createQuoteSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid quote data' });
    const scope = await getScope(request, reply); if (!scope) return;
    try { return reply.status(201).send({ quote: await repository.create(scope.organizationId, scope.serviceOrderId, parsed.data) }); }
    catch (error) { if (error instanceof QuoteAlreadyExistsError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Quote already exists' }); throw error; }
  });

  app.get('/:serviceOrderId/quote', { preHandler: requireAuthentication }, async (request, reply) => {
    const scope = await getScope(request, reply); if (!scope) return;
    const quote = await repository.findByServiceOrder(scope.organizationId, scope.serviceOrderId);
    if (!quote) return notFound(reply);
    return reply.send({ quote });
  });

  app.patch('/:serviceOrderId/quote', { preHandler: requireAuthentication }, async (request, reply) => {
    const parsed = updateQuoteSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid quote data' });
    const scope = await getScope(request, reply); if (!scope) return;
    const quote = await repository.update(scope.organizationId, scope.serviceOrderId, parsed.data);
    if (!quote) return notFound(reply);
    return reply.send({ quote });
  });

  app.patch('/:serviceOrderId/quote/status', { preHandler: requireAuthentication }, async (request, reply) => {
    const parsed = updateQuoteStatusSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid quote status' });
    const scope = await getScope(request, reply); if (!scope) return;
    const current = await repository.findByServiceOrder(scope.organizationId, scope.serviceOrderId);
    if (!current) return notFound(reply);
    if (!transitions[current.status].includes(parsed.data.status)) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Invalid quote status transition' });
    return reply.send({ quote: await repository.updateStatus(scope.organizationId, scope.serviceOrderId, parsed.data.status) });
  });

  app.delete('/:serviceOrderId/quote', { preHandler: requireAuthentication }, async (request, reply) => {
    const scope = await getScope(request, reply); if (!scope) return;
    try { const deleted = await repository.delete(scope.organizationId, scope.serviceOrderId); if (!deleted) return notFound(reply); return reply.status(204).send(); }
    catch (error) { if (error instanceof QuoteInUseError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Quote has related items' }); throw error; }
  });

  app.post('/:serviceOrderId/quote/items', { preHandler: requireAuthentication }, async (request, reply) => {
    const parsed = createServiceItemSchema.safeParse(request.body); if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid service item data' });
    const scope = await getScope(request, reply); if (!scope) return;
    try { return reply.status(201).send({ quote: await repository.addItem(scope.organizationId, scope.serviceOrderId, parsed.data) }); }
    catch (error) { if (error instanceof QuoteNotFoundError) return notFound(reply); throw error; }
  });

  app.patch('/:serviceOrderId/quote/items/:itemId', { preHandler: requireAuthentication }, async (request, reply) => {
    const parsed = updateServiceItemSchema.safeParse(request.body); if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid service item data' });
    const scope = await getScope(request, reply); if (!scope) return;
    const quote = await repository.updateItem(scope.organizationId, scope.serviceOrderId, (request.params as { itemId: string }).itemId, parsed.data);
    if (!quote) return notFound(reply);
    return reply.send({ quote });
  });

  app.delete('/:serviceOrderId/quote/items/:itemId', { preHandler: requireAuthentication }, async (request, reply) => {
    const scope = await getScope(request, reply); if (!scope) return;
    const quote = await repository.deleteItem(scope.organizationId, scope.serviceOrderId, (request.params as { itemId: string }).itemId);
    if (!quote) return notFound(reply);
    return reply.send({ quote });
  });
}