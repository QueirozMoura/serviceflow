import { z } from 'zod';
import { pageQueryShape, searchTermSchema } from '../shared/pagination.js';

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const createEquipmentSchema = z
  .object({
    customerId: z.string().uuid(),
    type: z.string().trim().min(2).max(120),
    brand: optionalText(120),
    model: optionalText(120),
    serialNumber: optionalText(120),
    description: optionalText(2000),
  })
  .strict();

export const updateEquipmentSchema = createEquipmentSchema
  .omit({ customerId: true })
  .extend({ customerId: z.string().uuid().optional() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' })
  .strict();

// customerId e validado a parte na rota (formato + pertence a organizacao), mantendo a resposta 400 'Customer not found'.
export const listEquipmentQuerySchema = z.object({ ...pageQueryShape, q: searchTermSchema });

export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>;
export type ListEquipmentQuery = z.infer<typeof listEquipmentQuerySchema> & { customerId?: string };