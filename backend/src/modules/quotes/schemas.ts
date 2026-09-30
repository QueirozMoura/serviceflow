import { QuoteStatus, ServiceItemType } from '@prisma/client';
import { z } from 'zod';

const money = z.union([z.string(), z.number()]).refine((value) => /^\d+(\.\d{1,2})?$/.test(String(value)), 'Invalid monetary value').transform(String);
const quantity = z.union([z.string(), z.number()]).refine((value) => /^\d+(\.\d{1,3})?$/.test(String(value)) && Number(value) > 0, 'Invalid quantity').transform(String);

export const createQuoteSchema = z.object({ notes: z.string().trim().max(4000).nullable().optional() }).strict();
export const updateQuoteSchema = createQuoteSchema.extend({}).partial().refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' }).strict();
export const updateQuoteStatusSchema = z.object({ status: z.nativeEnum(QuoteStatus) }).strict();

export const createServiceItemSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity,
  unitPrice: money,
  type: z.nativeEnum(ServiceItemType),
}).strict();

export const updateServiceItemSchema = createServiceItemSchema.partial().refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' }).strict();

export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;
export type UpdateQuoteInput = z.infer<typeof updateQuoteSchema>;
export type CreateServiceItemInput = z.infer<typeof createServiceItemSchema>;
export type UpdateServiceItemInput = z.infer<typeof updateServiceItemSchema>;