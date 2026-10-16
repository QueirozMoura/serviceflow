import { z } from 'zod';
import { pageQueryShape, searchTermSchema } from '../shared/pagination.js';

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const createCustomerSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().toLowerCase().optional(),
    phone: z.string().trim().min(3).max(30),
    document: optionalText(40),
    address: optionalText(240),
    notes: optionalText(2000),
  })
  .strict();

export const updateCustomerSchema = createCustomerSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' })
  .strict();

export const listCustomersQuerySchema = z.object({ ...pageQueryShape, q: searchTermSchema });

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;