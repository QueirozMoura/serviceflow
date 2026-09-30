import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middlewares/authenticate.js';
import type { AuthRepository } from '../modules/auth/repository.js';
import { generateMessage, MessageDataUnavailableError } from '../modules/messages/message-generator.js';
import { PrismaMessageRepository, type MessageRepository } from '../modules/messages/repository.js';
import { createMessageSchema } from '../modules/messages/schemas.js';

type MessageRoutesOptions = { authRepository?: AuthRepository; messageRepository?: MessageRepository };

export async function messageRoutes(app: FastifyInstance, options: MessageRoutesOptions = {}): Promise<void> {
  const repository = options.messageRepository ?? new PrismaMessageRepository(prisma);
  if (!options.authRepository) throw new Error('Message routes require an auth repository');
  const requireAuthentication = authenticate(options.authRepository);

  app.post('/:serviceOrderId/messages', { preHandler: requireAuthentication }, async (request, reply) => {
    const parsed = createMessageSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid message type' });
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    const serviceOrderId = (request.params as { serviceOrderId: string }).serviceOrderId;
    const context = await repository.findContext(request.user.organizationId, serviceOrderId, parsed.data.type);
    if (!context) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Service order not found' });
    try {
      return reply.send(generateMessage(parsed.data.type, context));
    } catch (error) {
      if (error instanceof MessageDataUnavailableError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: error.message });
      throw error;
    }
  });
}