import { ServiceOrderStatus } from '@prisma/client';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middlewares/authenticate.js';
import type { AuthRepository } from '../modules/auth/repository.js';
import { PrismaServiceOrderRepository, ServiceOrderInUseError, type ServiceOrderRepository } from '../modules/service-orders/repository.js';
import { createServiceOrderSchema, serviceOrderStatusQuerySchema, updateServiceOrderSchema, updateServiceOrderStatusSchema } from '../modules/service-orders/schemas.js';

type ServiceOrderRoutesOptions = { authRepository?: AuthRepository; serviceOrderRepository?: ServiceOrderRepository; database?: PrismaClient };

function notFound(reply: FastifyReply) {
  return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Service order not found' });
}

function invalidReferences(reply: FastifyReply) {
  return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid customer or equipment' });
}

const transitions: Record<ServiceOrderStatus, ServiceOrderStatus[]> = {
  RECEIVED: [ServiceOrderStatus.WAITING_DIAGNOSIS, ServiceOrderStatus.CANCELLED],
  WAITING_DIAGNOSIS: [ServiceOrderStatus.WAITING_APPROVAL, ServiceOrderStatus.CANCELLED],
  WAITING_APPROVAL: [ServiceOrderStatus.APPROVED, ServiceOrderStatus.CANCELLED],
  APPROVED: [ServiceOrderStatus.IN_PROGRESS, ServiceOrderStatus.CANCELLED],
  IN_PROGRESS: [ServiceOrderStatus.READY, ServiceOrderStatus.CANCELLED],
  READY: [ServiceOrderStatus.DELIVERED, ServiceOrderStatus.CANCELLED],
  DELIVERED: [],
  CANCELLED: [],
};

export async function serviceOrderRoutes(app: FastifyInstance, options: ServiceOrderRoutesOptions = {}): Promise<void> {
  const repository = options.serviceOrderRepository ?? new PrismaServiceOrderRepository(options.database ?? prisma);
  if (!options.authRepository) throw new Error('Service order routes require an auth repository');
  const requireAuthentication = authenticate(options.authRepository);

  app.post('/', { preHandler: requireAuthentication }, async (request, reply) => {
    const parsed = createServiceOrderSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid service order data' });
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    if (!(await repository.referencesBelongToOrganization(request.user.organizationId, parsed.data.customerId, parsed.data.equipmentId))) return invalidReferences(reply);

    const serviceOrder = await repository.create(request.user.organizationId, request.user.id, parsed.data);
    return reply.status(201).send({ serviceOrder });
  });

  app.get('/', { preHandler: requireAuthentication }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    const query = request.query as { status?: string; customerId?: string; equipmentId?: string };
    const parsed = serviceOrderStatusQuerySchema.safeParse({ status: query.status });
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid service order filter' });
    const uuid = /^[0-9a-f-]{36}$/i;
    if ((query.customerId && !uuid.test(query.customerId)) || (query.equipmentId && !uuid.test(query.equipmentId))) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid service order filter' });

    const serviceOrders = await repository.list(request.user.organizationId, { status: parsed.data.status, customerId: query.customerId, equipmentId: query.equipmentId });
    return reply.send({ serviceOrders });
  });

  app.get('/:id', { preHandler: requireAuthentication }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    const serviceOrder = await repository.findById(request.user.organizationId, (request.params as { id: string }).id);
    if (!serviceOrder) return notFound(reply);
    return reply.send({ serviceOrder });
  });

  app.patch('/:id/status', { preHandler: requireAuthentication }, async (request, reply) => {
    const parsed = updateServiceOrderStatusSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid service order status' });
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    const current = await repository.findById(request.user.organizationId, (request.params as { id: string }).id);
    if (!current) return notFound(reply);
    if (!transitions[current.status].includes(parsed.data.status)) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Invalid service order status transition' });

    const serviceOrder = await repository.updateStatus(request.user.organizationId, current.id, request.user.id, parsed.data.status);
    if (!serviceOrder) return notFound(reply);
    return reply.send({ serviceOrder });
  });

  app.patch('/:id', { preHandler: requireAuthentication }, async (request, reply) => {
    const parsed = updateServiceOrderSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid service order data' });
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    const current = await repository.findById(request.user.organizationId, (request.params as { id: string }).id);
    if (!current) return notFound(reply);
    const customerId = parsed.data.customerId ?? current.customerId;
    const equipmentId = parsed.data.equipmentId ?? current.equipmentId;
    if (!(await repository.referencesBelongToOrganization(request.user.organizationId, customerId, equipmentId))) return invalidReferences(reply);

    const serviceOrder = await repository.update(request.user.organizationId, current.id, parsed.data);
    if (!serviceOrder) return notFound(reply);
    return reply.send({ serviceOrder });
  });

  app.delete('/:id', { preHandler: requireAuthentication }, async (request, reply) => {
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