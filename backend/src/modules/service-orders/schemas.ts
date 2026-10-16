import { ServiceOrderStatus } from '@prisma/client';
import { z } from 'zod';
import { pageQueryShape, searchTermSchema } from '../shared/pagination.js';

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const money = z.union([z.string(), z.number()]).refine((value) => {
  const normalized = String(value);
  return /^\d+(\.\d{1,2})?$/.test(normalized);
}, 'Invalid monetary value').transform(String);

export const createServiceOrderSchema = z
  .object({
    customerId: z.string().uuid(),
    equipmentId: z.string().uuid(),
    problemDescription: z.string().trim().min(2).max(4000),
    technicianNotes: optionalText(4000),
    estimatedValue: money.nullable().optional(),
    finalValue: money.nullable().optional(),
  })
  .strict();

export const updateServiceOrderSchema = createServiceOrderSchema
  .omit({ customerId: true, equipmentId: true })
  .extend({ customerId: z.string().uuid().optional(), equipmentId: z.string().uuid().optional() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' })
  .strict();

export const updateServiceOrderStatusSchema = z.object({ status: z.nativeEnum(ServiceOrderStatus) }).strict();


const uuidLike = z.string().regex(/^[0-9a-f-]{36}$/i);

// Somente estes filtros existem; nao ha ordenacao nem campos arbitrarios. Parametros desconhecidos sao descartados.
export const listServiceOrdersQuerySchema = z.object({
  ...pageQueryShape,
  q: searchTermSchema,
  status: z.nativeEnum(ServiceOrderStatus).optional(),
  customerId: uuidLike.optional(),
  equipmentId: uuidLike.optional(),
});

export type CreateServiceOrderInput = z.infer<typeof createServiceOrderSchema>;
export type UpdateServiceOrderInput = z.infer<typeof updateServiceOrderSchema>;
export type ListServiceOrdersQuery = z.infer<typeof listServiceOrdersQuerySchema>;