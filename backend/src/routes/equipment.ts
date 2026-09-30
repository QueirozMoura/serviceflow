import type { FastifyInstance, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middlewares/authenticate.js';
import type { AuthRepository } from '../modules/auth/repository.js';
import { EquipmentInUseError, PrismaEquipmentRepository, type EquipmentRepository } from '../modules/equipment/repository.js';
import { createEquipmentSchema, updateEquipmentSchema } from '../modules/equipment/schemas.js';

type EquipmentRoutesOptions = {
  authRepository?: AuthRepository;
  equipmentRepository?: EquipmentRepository;
  database?: PrismaClient;
};

function notFound(reply: FastifyReply) {
  return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Equipment not found' });
}

function invalidCustomer(reply: FastifyReply) {
  return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Customer not found' });
}

export async function equipmentRoutes(app: FastifyInstance, options: EquipmentRoutesOptions = {}): Promise<void> {
  const repository = options.equipmentRepository ?? new PrismaEquipmentRepository(options.database ?? prisma);
  if (!options.authRepository) throw new Error('Equipment routes require an auth repository');
  const requireAuthentication = authenticate(options.authRepository);

  app.post('/', { preHandler: requireAuthentication }, async (request, reply) => {
    const parsed = createEquipmentSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid equipment data' });
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    if (!(await repository.customerBelongsToOrganization(request.user.organizationId, parsed.data.customerId))) return invalidCustomer(reply);

    const equipment = await repository.create(request.user.organizationId, parsed.data);
    return reply.status(201).send({ equipment });
  });

  app.get('/', { preHandler: requireAuthentication }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    const customerId = (request.query as { customerId?: string }).customerId;
    if (customerId && !/^[0-9a-f-]{36}$/i.test(customerId)) return invalidCustomer(reply);
    if (customerId && !(await repository.customerBelongsToOrganization(request.user.organizationId, customerId))) return invalidCustomer(reply);

    const equipment = await repository.list(request.user.organizationId, customerId);
    return reply.send({ equipment });
  });

  app.get('/:id', { preHandler: requireAuthentication }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    const equipment = await repository.findById(request.user.organizationId, (request.params as { id: string }).id);
    if (!equipment) return notFound(reply);
    return reply.send({ equipment });
  });

  app.patch('/:id', { preHandler: requireAuthentication }, async (request, reply) => {
    const parsed = updateEquipmentSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid equipment data' });
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    if (parsed.data.customerId && !(await repository.customerBelongsToOrganization(request.user.organizationId, parsed.data.customerId))) return invalidCustomer(reply);

    const equipment = await repository.update(request.user.organizationId, (request.params as { id: string }).id, parsed.data);
    if (!equipment) return notFound(reply);
    return reply.send({ equipment });
  });

  app.delete('/:id', { preHandler: requireAuthentication }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    try {
      const deleted = await repository.delete(request.user.organizationId, (request.params as { id: string }).id);
      if (!deleted) return notFound(reply);
      return reply.status(204).send();
    } catch (error) {
      if (error instanceof EquipmentInUseError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: error.message });
      throw error;
    }
  });
}