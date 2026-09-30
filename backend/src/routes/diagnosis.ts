import type { FastifyInstance, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middlewares/authenticate.js';
import type { AuthRepository } from '../modules/auth/repository.js';
import { DiagnosisAlreadyExistsError, DiagnosisInUseError, PrismaDiagnosisRepository, type DiagnosisRepository } from '../modules/diagnosis/repository.js';
import { createDiagnosisSchema, updateDiagnosisSchema } from '../modules/diagnosis/schemas.js';

type DiagnosisRoutesOptions = { authRepository?: AuthRepository; diagnosisRepository?: DiagnosisRepository; database?: PrismaClient };

function notFound(reply: FastifyReply) {
  return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Diagnosis not found' });
}

export async function diagnosisRoutes(app: FastifyInstance, options: DiagnosisRoutesOptions = {}): Promise<void> {
  const repository = options.diagnosisRepository ?? new PrismaDiagnosisRepository(options.database ?? prisma);
  if (!options.authRepository) throw new Error('Diagnosis routes require an auth repository');
  const requireAuthentication = authenticate(options.authRepository);

  app.post('/:serviceOrderId/diagnosis', { preHandler: requireAuthentication }, async (request, reply) => {
    const parsed = createDiagnosisSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid diagnosis data' });
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    const serviceOrderId = (request.params as { serviceOrderId: string }).serviceOrderId;
    if (!(await repository.serviceOrderBelongsToOrganization(request.user.organizationId, serviceOrderId))) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Service order not found' });

    try {
      const diagnosis = await repository.create(request.user.organizationId, serviceOrderId, parsed.data);
      return reply.status(201).send({ diagnosis });
    } catch (error) {
      if (error instanceof DiagnosisAlreadyExistsError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: error.message });
      throw error;
    }
  });

  app.get('/:serviceOrderId/diagnosis', { preHandler: requireAuthentication }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    const serviceOrderId = (request.params as { serviceOrderId: string }).serviceOrderId;
    if (!(await repository.serviceOrderBelongsToOrganization(request.user.organizationId, serviceOrderId))) return notFound(reply);
    const diagnosis = await repository.findByServiceOrder(request.user.organizationId, serviceOrderId);
    if (!diagnosis) return notFound(reply);
    return reply.send({ diagnosis });
  });

  app.patch('/:serviceOrderId/diagnosis', { preHandler: requireAuthentication }, async (request, reply) => {
    const parsed = updateDiagnosisSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid diagnosis data' });
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    const serviceOrderId = (request.params as { serviceOrderId: string }).serviceOrderId;
    if (!(await repository.serviceOrderBelongsToOrganization(request.user.organizationId, serviceOrderId))) return notFound(reply);
    const diagnosis = await repository.update(request.user.organizationId, serviceOrderId, parsed.data);
    if (!diagnosis) return notFound(reply);
    return reply.send({ diagnosis });
  });

  app.delete('/:serviceOrderId/diagnosis', { preHandler: requireAuthentication }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    const serviceOrderId = (request.params as { serviceOrderId: string }).serviceOrderId;
    if (!(await repository.serviceOrderBelongsToOrganization(request.user.organizationId, serviceOrderId))) return notFound(reply);
    try {
      const deleted = await repository.delete(request.user.organizationId, serviceOrderId);
      if (!deleted) return notFound(reply);
      return reply.status(204).send();
    } catch (error) {
      if (error instanceof DiagnosisInUseError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: error.message });
      throw error;
    }
  });
}