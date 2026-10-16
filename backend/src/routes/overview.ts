import type { FastifyInstance, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middlewares/authenticate.js';
import { authorize } from '../middlewares/authorize.js';
import type { AuthRepository } from '../modules/auth/repository.js';
import { listPaymentsQuerySchema, listQuotesQuerySchema, listWarrantiesQuerySchema, PrismaOverviewRepository, type OverviewRepository } from '../modules/overview/repository.js';
import { buildPagination } from '../modules/shared/pagination.js';

type OverviewRoutesOptions = { authRepository?: AuthRepository; overviewRepository?: OverviewRepository };

const unauthorized = (reply: FastifyReply) => reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
const invalidFilter = (reply: FastifyReply) => reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid list filter' });

// Listagens agregadas, paginadas e filtradas no banco. O organizationId vem somente da sessao; da query so sao lidos
// page, pageSize, q e status (validados); qualquer outro parametro e descartado.
export async function overviewRoutes(app: FastifyInstance, options: OverviewRoutesOptions = {}): Promise<void> {
  const repository = options.overviewRepository ?? new PrismaOverviewRepository(prisma);
  if (!options.authRepository) throw new Error('Overview routes require an auth repository');
  const requireAuthentication = authenticate(options.authRepository);

  app.get('/quotes', { preHandler: [requireAuthentication, authorize('quotes:read')] }, async (request, reply) => {
    if (!request.user) return unauthorized(reply);
    const parsed = listQuotesQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidFilter(reply);
    const { items, total, summary } = await repository.listQuotes(request.user.organizationId, parsed.data);
    return reply.send({ quotes: items, pagination: buildPagination(parsed.data, total), summary });
  });

  app.get('/payments', { preHandler: [requireAuthentication, authorize('payments:read')] }, async (request, reply) => {
    if (!request.user) return unauthorized(reply);
    const parsed = listPaymentsQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidFilter(reply);
    const { items, total, summary } = await repository.listPayments(request.user.organizationId, parsed.data);
    return reply.send({ payments: items, pagination: buildPagination(parsed.data, total), summary });
  });

  app.get('/warranties', { preHandler: [requireAuthentication, authorize('warranties:read')] }, async (request, reply) => {
    if (!request.user) return unauthorized(reply);
    const parsed = listWarrantiesQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalidFilter(reply);
    const { items, total, summary } = await repository.listWarranties(request.user.organizationId, parsed.data);
    return reply.send({ warranties: items, pagination: buildPagination(parsed.data, total), summary });
  });
}
