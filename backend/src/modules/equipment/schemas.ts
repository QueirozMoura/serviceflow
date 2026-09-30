import { z } from 'zod';

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

export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>;