import type { FastifyInstance, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middlewares/authenticate.js';
import type { AuthRepository } from '../modules/auth/repository.js';
import { PrismaCustomerRepository, type CustomerRepository } from '../modules/customers/repository.js';
import { createCustomerSchema, updateCustomerSchema } from '../modules/customers/schemas.js';

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

  app.post('/', { preHandler: requireAuthentication }, async (request, reply) => {
    const parsed = createCustomerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid customer data' });
    }
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });

    const customer = await repository.create(request.user.organizationId, parsed.data);
    return reply.status(201).send({ customer });
  });

  app.get('/', { preHandler: requireAuthentication }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });

    const customers = await repository.list(request.user.organizationId);
    return reply.send({ customers });
  });

  app.get('/:id', { preHandler: requireAuthentication }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });

    const customer = await repository.findById(request.user.organizationId, (request.params as { id: string }).id);
    if (!customer) return notFound(reply);
    return reply.send({ customer });
  });

  app.patch('/:id', { preHandler: requireAuthentication }, async (request, reply) => {
    const parsed = updateCustomerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid customer data' });
    }
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });

    const customer = await repository.update(request.user.organizationId, (request.params as { id: string }).id, parsed.data);
    if (!customer) return notFound(reply);
    return reply.send({ customer });
  });

  app.delete('/:id', { preHandler: requireAuthentication }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });

    const deleted = await repository.delete(request.user.organizationId, (request.params as { id: string }).id);
    if (!deleted) return notFound(reply);
    return reply.status(204).send();
  });
}