import { ServiceOrderStatus, WarrantyStatus } from '@prisma/client';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middlewares/authenticate.js';
import type { AuthRepository } from '../modules/auth/repository.js';
import { PrismaWarrantyRepository, WarrantyAlreadyExistsError, WarrantyImmutableError, WarrantyInUseError, type WarrantyRepository } from '../modules/warranties/repository.js';
import { createWarrantySchema, updateWarrantySchema, updateWarrantyStatusSchema } from '../modules/warranties/schemas.js';

type WarrantyRoutesOptions = { authRepository?: AuthRepository; warrantyRepository?: WarrantyRepository; database?: PrismaClient };

function notFound(reply: FastifyReply, message = 'Warranty not found') { return reply.status(404).send({ statusCode: 404, error: 'Not Found', message }); }
const transitions: Record<WarrantyStatus, WarrantyStatus[]> = { ACTIVE: [WarrantyStatus.EXPIRED, WarrantyStatus.CANCELLED], EXPIRED: [], CANCELLED: [] };

export async function warrantyRoutes(app: FastifyInstance, options: WarrantyRoutesOptions = {}): Promise<void> {
  const repository = options.warrantyRepository ?? new PrismaWarrantyRepository(options.database ?? prisma);
  if (!options.authRepository) throw new Error('Warranty routes require an auth repository');
  const requireAuthentication = authenticate(options.authRepository);

  const getScope = async (request: { user: { organizationId: string } | null; params: unknown }, reply: FastifyReply) => {
    if (!request.user) { reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' }); return null; }
    const serviceOrderId = (request.params as { serviceOrderId: string }).serviceOrderId;
    const status = await repository.serviceOrderStatus(request.user.organizationId, serviceOrderId);
    if (!status) { notFound(reply, 'Service order not found'); return null; }
    return { organizationId: request.user.organizationId, serviceOrderId, status };
  };

  app.post('/:serviceOrderId/warranty', { preHandler: requireAuthentication }, async (request, reply) => {
    const parsed = createWarrantySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid warranty data' });
    const scope = await getScope(request, reply); if (!scope) return;
    if (scope.status !== ServiceOrderStatus.DELIVERED) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Warranty requires a delivered service order' });
    try { return reply.status(201).send({ warranty: await repository.create(scope.organizationId, scope.serviceOrderId, parsed.data) }); }
    catch (error) { if (error instanceof WarrantyAlreadyExistsError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Warranty already exists' }); throw error; }
  });

  app.get('/:serviceOrderId/warranty', { preHandler: requireAuthentication }, async (request, reply) => {
    const scope = await getScope(request, reply); if (!scope) return;
    const warranty = await repository.findByServiceOrder(scope.organizationId, scope.serviceOrderId);
    if (!warranty) return notFound(reply);
    return reply.send({ warranty });
  });

  app.patch('/:serviceOrderId/warranty', { preHandler: requireAuthentication }, async (request, reply) => {
    const parsed = updateWarrantySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid warranty data' });
    const scope = await getScope(request, reply); if (!scope) return;
    const current = await repository.findByServiceOrder(scope.organizationId, scope.serviceOrderId);
    if (!current) return notFound(reply);
    const startDate = parsed.data.startDate ?? current.startDate;
    const endDate = parsed.data.endDate ?? current.endDate;
    if (startDate > endDate) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'End date must be on or after start date' });
    try { return reply.send({ warranty: await repository.update(scope.organizationId, scope.serviceOrderId, parsed.data) }); }
    catch (error) { if (error instanceof WarrantyImmutableError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Warranty is immutable' }); throw error; }
  });

  app.patch('/:serviceOrderId/warranty/status', { preHandler: requireAuthentication }, async (request, reply) => {
    const parsed = updateWarrantyStatusSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid warranty status' });
    const scope = await getScope(request, reply); if (!scope) return;
    const warranty = await repository.findByServiceOrder(scope.organizationId, scope.serviceOrderId);
    if (!warranty) return notFound(reply);
    if (!transitions[warranty.status].includes(parsed.data.status)) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Invalid warranty status transition' });
    return reply.send({ warranty: await repository.updateStatus(scope.organizationId, scope.serviceOrderId, parsed.data.status) });
  });

  app.delete('/:serviceOrderId/warranty', { preHandler: requireAuthentication }, async (request, reply) => {
    const scope = await getScope(request, reply); if (!scope) return;
    try { const deleted = await repository.delete(scope.organizationId, scope.serviceOrderId); if (!deleted) return notFound(reply); return reply.status(204).send(); }
    catch (error) { if (error instanceof WarrantyImmutableError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Warranty is immutable' }); if (error instanceof WarrantyInUseError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Warranty has related records' }); throw error; }
  });
}