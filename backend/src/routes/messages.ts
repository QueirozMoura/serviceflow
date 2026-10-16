import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middlewares/authenticate.js';
import { authorize } from '../middlewares/authorize.js';
import type { AuthRepository } from '../modules/auth/repository.js';
import { generateMessage, MessageDataUnavailableError } from '../modules/messages/message-generator.js';
import { PrismaMessageRepository, RecipientChannelUnavailableError, type MessageHistoryRecord, type MessageRepository } from '../modules/messages/repository.js';
import { createMessageSchema, idempotencyKeySchema, recordMessageSchema } from '../modules/messages/schemas.js';

type MessageRoutesOptions = { authRepository?: AuthRepository; messageRepository?: MessageRepository };

export async function messageRoutes(app: FastifyInstance, options: MessageRoutesOptions = {}): Promise<void> {
  const repository = options.messageRepository ?? new PrismaMessageRepository(prisma);
  if (!options.authRepository) throw new Error('Message routes require an auth repository');
  const requireAuthentication = authenticate(options.authRepository);

  app.post('/:serviceOrderId/messages', { preHandler: [requireAuthentication, authorize('messages:generate')] }, async (request, reply) => {
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

  // Resposta publica de um registro: sem organizationId, sem telefone/e-mail do cliente.
  const present = (record: MessageHistoryRecord) => ({ id: record.id, type: record.type, channel: record.channel, status: record.status, content: record.content, createdAt: record.createdAt, createdBy: record.createdBy, recipient: record.recipient });
  // Constante enquanto nao houver provedor de e-mail/WhatsApp integrado e configurado.
  const sendingAvailable = false;

  app.get('/:serviceOrderId/messages/history', { preHandler: [requireAuthentication, authorize('messages:read')] }, async (request, reply) => {
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    const messages = await repository.listHistory(request.user.organizationId, (request.params as { serviceOrderId: string }).serviceOrderId);
    if (!messages) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Service order not found' });
    return reply.send({ messages: messages.map(present), sendingAvailable });
  });

  // Registra um RASCUNHO no historico. Nada e enviado: o conteudo e gerado aqui, a partir dos dados da OS da sessao.
  app.post('/:serviceOrderId/messages/history', { preHandler: [requireAuthentication, authorize('messages:write')] }, async (request, reply) => {
    const parsed = recordMessageSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid message data' });
    const rawKey = request.headers['idempotency-key'];
    const keyResult = rawKey === undefined ? null : idempotencyKeySchema.safeParse(rawKey);
    if (keyResult && !keyResult.success) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid idempotency key' });
    const idempotencyKey = keyResult?.success ? keyResult.data : undefined;
    if (!request.user) return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Authentication required' });
    const { organizationId, id: userId } = request.user;
    const serviceOrderId = (request.params as { serviceOrderId: string }).serviceOrderId;

    const sameRequest = (record: MessageHistoryRecord) => record.serviceOrderId === serviceOrderId && record.type === parsed.data.type && record.channel === parsed.data.channel;
    const conflict = () => reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Idempotency key was already used with different data' });

    if (idempotencyKey) {
      const existing = await repository.findHistoryByKey(organizationId, idempotencyKey);
      if (existing) return sameRequest(existing) ? reply.send({ message: present(existing), sendingAvailable }) : conflict();
    }

    const context = await repository.findContext(organizationId, serviceOrderId, parsed.data.type);
    if (!context) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Service order not found' });
    let content: string;
    try {
      content = generateMessage(parsed.data.type, context).message;
    } catch (error) {
      if (error instanceof MessageDataUnavailableError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: error.message });
      throw error;
    }

    try {
      const result = await repository.createHistory({ organizationId, createdByUserId: userId, serviceOrderId, type: parsed.data.type, channel: parsed.data.channel, content, idempotencyKey });
      if (!result) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Service order not found' });
      if (!result.created) return sameRequest(result.record) ? reply.send({ message: present(result.record), sendingAvailable }) : conflict();
      return reply.status(201).send({ message: present(result.record), sendingAvailable });
    } catch (error) {
      if (error instanceof RecipientChannelUnavailableError) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Customer has no e-mail address registered' });
      throw error;
    }
  });
}
