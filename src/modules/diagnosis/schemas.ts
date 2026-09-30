import { z } from 'zod';

const estimatedCost = z
  .union([z.string(), z.number()])
  .refine((value) => /^\d+(\.\d{1,2})?$/.test(String(value)), 'Invalid monetary value')
  .transform(String)
  .nullable()
  .optional();

export const createDiagnosisSchema = z
  .object({
    description: z.string().trim().min(2).max(4000),
    estimatedCost,
  })
  .strict();

export const updateDiagnosisSchema = createDiagnosisSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' })
  .strict();

export type CreateDiagnosisInput = z.infer<typeof createDiagnosisSchema>;
export type UpdateDiagnosisInput = z.infer<typeof updateDiagnosisSchema>;