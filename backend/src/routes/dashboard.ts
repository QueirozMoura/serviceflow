import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middlewares/authenticate.js';
import type { AuthRepository } from '../modules/auth/repository.js';
import { PrismaDashboardRepository, type DashboardRepository } from '../modules/dashboard/repository.js';

type DashboardRoutesOptions = { authRepository?: AuthRepository; dashboardRepository?: DashboardRepository };

export async function dashboardRoutes(app: FastifyInstance, options: DashboardRoutesOptions = {}): Promise<void> {
  const repository = options.dashboardRepository ?? new PrismaDashboardRepository(prisma);
  if (!options.authRepository) throw new Error('Dashboard routes require an auth repository');
  const requireAuthentication = authenticate(options.authRepository);

  app.get('/', { preHandler: requireAuthentication }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    return reply.send(await repository.getDashboard(request.user.organizationId));
  });
}