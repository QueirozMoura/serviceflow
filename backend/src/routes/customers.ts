import type { FastifyInstance, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middlewares/authenticate.js';
import { authorize } from '../middlewares/authorize.js';
import type { AuthRepository } from '../modules/auth/repository.js';
import { CustomerInUseError, PrismaCustomerRepository, type CustomerRepository } from '../modules/customers/repository.js';
import { createCustomerSchema, listCustomersQuerySchema, updateCustomerSchema } from '../modules/customers/schemas.js';
import { buildPagination } from '../modules/shared/pagination.js';

type CustomerRoutesOptions = {
  authRepository?: AuthRepository;
  customerRepository?: CustomerRepository;
  database?: PrismaClient;
};

function notFound(reply: FastifyReply) {
  return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Customer not found' });
}

export async function customerRoutes(app: FastifyInstance, options: CustomerRoutesOptions = {}): Promise<void> {
  const database = options.database ?? prisma;
  const repository = options.customerRepository ?? new PrismaCustomerRepository(database);
  if (!options.authRepository) throw new Error('Customer routes require an auth repository');
  const requireAuthentication = authenticate(options.authRepository);

  app.post('/', { preHandler: [requireAuthentication, authorize('customers:write')] }, async (request, reply) => {
    const parsed = createCustomerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid customer data' });
    }
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });

    const customer = await repository.create(request.user.organizationId, parsed.data);
    return reply.status(201).send({ customer });
  });

  app.get('/', { preHandler: [requireAuthentication, authorize('customers:read')] }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });

    const parsed = listCustomersQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid customer filter' });

    const { items, total } = await repository.list(request.user.organizationId, parsed.data);
    return reply.send({ customers: items, pagination: buildPagination(parsed.data, total) });
  });

  // Lista completa e enxuta para seletores (formularios); nao e paginada de proposito.
  app.get('/options', { preHandler: [requireAuthentication, authorize('customers:read')] }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    return reply.send({ customers: await repository.listOptions(request.user.organizationId) });
  });

  app.get('/:id', { preHandler: [requireAuthentication, authorize('customers:read')] }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });

    const customer = await repository.findById(request.user.organizationId, (request.params as { id: string }).id);
    if (!customer) return notFound(reply);
    return reply.send({ customer });
  });

  app.patch('/:id', { preHandler: [requireAuthentication, authorize('customers:write')] }, async (request, reply) => {
    const parsed = updateCustomerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid customer data' });
    }
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });

    const customer = await repository.update(request.user.organizationId, (request.params as { id: string }).id, parsed.data);
    if (!customer) return notFound(reply);
    return reply.send({ customer });
  });

  app.delete('/:id', { preHandler: [requireAuthentication, authorize('customers:delete')] }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });

    try {
      const deleted = await repository.delete(request.user.organizationId, (request.params as { id: string }).id);
      if (!deleted) return notFound(reply);
      return reply.status(204).send();
    } catch (error) {
      if (error instanceof CustomerInUseError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: error.message });
      throw error;
    }
  });
}