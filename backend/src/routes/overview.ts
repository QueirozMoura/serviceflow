import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middlewares/authenticate.js';
import { authorize } from '../middlewares/authorize.js';
import type { AuthRepository } from '../modules/auth/repository.js';
import { PrismaOverviewRepository, type OverviewRepository } from '../modules/overview/repository.js';

type OverviewRoutesOptions = { authRepository?: AuthRepository; overviewRepository?: OverviewRepository };

// Listagens agregadas (uma requisicao por tela). O organizationId vem somente da sessao; nenhum parametro do cliente e lido.
export async function overviewRoutes(app: FastifyInstance, options: OverviewRoutesOptions = {}): Promise<void> {
  const repository = options.overviewRepository ?? new PrismaOverviewRepository(prisma);
  if (!options.authRepository) throw new Error('Overview routes require an auth repository');
  const requireAuthentication = authenticate(options.authRepository);

  app.get('/quotes', { preHandler: [requireAuthentication, authorize('quotes:read')] }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    return reply.send({ quotes: await repository.listQuotes(request.user.organizationId) });
  });

  app.get('/payments', { preHandler: [requireAuthentication, authorize('payments:read')] }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    return reply.send({ payments: await repository.listPayments(request.user.organizationId) });
  });

  app.get('/warranties', { preHandler: [requireAuthentication, authorize('warranties:read')] }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    return reply.send({ warranties: await repository.listWarranties(request.user.organizationId) });
  });
}
