import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      request.log.error({ err: error }, 'Health check failed: database unreachable');
      return reply.status(503).send({ status: 'error' });
    }

    return { status: 'ok' };
  });
}
