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

export type MessageType = z.infer<typeof messageTypeSchema>;