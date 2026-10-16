import { z } from 'zod';

export const messageTypeSchema = z.enum([
  'SERVICE_RECEIVED',
  'DIAGNOSIS_READY',
  'QUOTE_READY',
  'QUOTE_APPROVED',
  'SERVICE_IN_PROGRESS',
  'SERVICE_READY',
  'SERVICE_DELIVERED',
  'WARRANTY_CREATED',
]);

export const createMessageSchema = z.object({ type: messageTypeSchema }).strict();

// Canais explicitos. Nao ha provedor integrado: registrar uma mensagem NAO a envia.
export const messageChannelSchema = z.enum(['WHATSAPP', 'EMAIL']);

// O texto e sempre gerado no servidor a partir dos dados da OS; o cliente so escolhe modelo e canal.
export const recordMessageSchema = z.object({ type: messageTypeSchema, channel: messageChannelSchema }).strict();

export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/);

export type MessageType = z.infer<typeof messageTypeSchema>;
export type MessageChannel = z.infer<typeof messageChannelSchema>;