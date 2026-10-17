import { DueValueBelowReservedError } from '../modules/shared/due-value.js';
import { SERVICE_ORDER_TRANSITIONS } from '../modules/shared/lifecycle.js';
import { hasPermission } from '../modules/auth/permissions.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middlewares/authenticate.js';
import { authorize, ensurePermission } from '../middlewares/authorize.js';
import type { AuthRepository } from '../modules/auth/repository.js';
import { serviceOrderStatusPermission } from '../modules/auth/permissions.js';
import { PrismaServiceOrderRepository, ServiceOrderInUseError, type ServiceOrderRepository } from '../modules/service-orders/repository.js';
import { buildPagination } from '../modules/shared/pagination.js';
import { createServiceOrderSchema, listServiceOrdersQuerySchema, updateServiceOrderSchema, updateServiceOrderStatusSchema } from '../modules/service-orders/schemas.js';

type ServiceOrderRoutesOptions = { authRepository?: AuthRepository; serviceOrderRepository?: ServiceOrderRepository; database?: PrismaClient };

function notFound(reply: FastifyReply) {
  return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Service order not found' });
}

function invalidReferences(reply: FastifyReply) {
  return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid customer or equipment' });
}


export async function serviceOrderRoutes(app: FastifyInstance, options: ServiceOrderRoutesOptions = {}): Promise<void> {
  const repository = options.serviceOrderRepository ?? new PrismaServiceOrderRepository(options.database ?? prisma);
  if (!options.authRepository) throw new Error('Service order routes require an auth repository');
  const requireAuthentication = authenticate(options.authRepository);

  app.post('/', { preHandler: [requireAuthentication, authorize('serviceOrders:write')] }, async (request, reply) => {
    const parsed = createServiceOrderSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid service order data' });
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    // Definir valores estimado/final e decisao financeira: so quem tem serviceOrders:value (OWNER/ADMIN).
    if ((parsed.data.estimatedValue != null || parsed.data.finalValue != null) && !ensurePermission(request, reply, 'serviceOrders:value')) return reply;
    if (!(await repository.referencesBelongToOrganization(request.user.organizationId, parsed.data.customerId, parsed.data.equipmentId))) return invalidReferences(reply);

    const serviceOrder = await repository.create(request.user.organizationId, request.user.id, parsed.data);
    return reply.status(201).send({ serviceOrder });
  });

  app.get('/', { preHandler: [requireAuthentication, authorize('serviceOrders:read')] }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    const parsed = listServiceOrdersQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid service order filter' });

    const { items, total } = await repository.list(request.user.organizationId, parsed.data);
    return reply.send({ serviceOrders: items, pagination: buildPagination(parsed.data, total) });
  });

  app.get('/:id', { preHandler: [requireAuthentication, authorize('serviceOrders:read')] }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    const serviceOrder = await repository.findById(request.user.organizationId, (request.params as { id: string }).id);
    if (!serviceOrder) return notFound(reply);
    return reply.send({ serviceOrder });
  });

  app.patch('/:id/status', { preHandler: [requireAuthentication, authorize('serviceOrders:write')] }, async (request, reply) => {
    const parsed = updateServiceOrderStatusSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid service order status' });
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    // Cancelar exige permissao propria; checado antes de consultar a OS para o 403 nao revelar se ela existe.
    if (!ensurePermission(request, reply, serviceOrderStatusPermission(parsed.data.status))) return reply;
    const current = await repository.findById(request.user.organizationId, (request.params as { id: string }).id);
    if (!current) return notFound(reply);
    if (!SERVICE_ORDER_TRANSITIONS[current.status].includes(parsed.data.status)) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Invalid service order status transition' });

    const serviceOrder = await repository.updateStatus(request.user.organizationId, current.id, request.user.id, parsed.data.status);
    if (!serviceOrder) return notFound(reply);
    return reply.send({ serviceOrder });
  });

  app.patch('/:id', { preHandler: [requireAuthentication, authorize('serviceOrders:write')] }, async (request, reply) => {
    const parsed = updateServiceOrderSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid service order data' });
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    const current = await repository.findById(request.user.organizationId, (request.params as { id: string }).id);
    if (!current) return notFound(reply);
    const customerId = parsed.data.customerId ?? current.customerId;
    const equipmentId = parsed.data.equipmentId ?? current.equipmentId;
    if (!(await repository.referencesBelongToOrganization(request.user.organizationId, customerId, equipmentId))) return invalidReferences(reply);

    try {
      const serviceOrder = await repository.update(request.user.organizationId, current.id, parsed.data, { canEditValues: hasPermission(request.user.role, 'serviceOrders:value') });
      if (!serviceOrder) return notFound(reply);
      return reply.send({ serviceOrder });
    } catch (error) {
      if (error instanceof DueValueBelowReservedError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'The change would leave active payments above the amount due' });
      throw error;
    }
  });

  app.delete('/:id', { preHandler: [requireAuthentication, authorize('serviceOrders:delete')] }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    try {
      const deleted = await repository.delete(request.user.organizationId, (request.params as { id: string }).id);
      if (!deleted) return notFound(reply);
      return reply.status(204).send();
    } catch (error) {
      if (error instanceof ServiceOrderInUseError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: error.message });
      throw error;
    }
  });
}