import { WarrantyStatus } from '@prisma/client';
import { z } from 'zod';

const warrantyDates = {
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
};

export const createWarrantySchema = z.object({
  ...warrantyDates,
  description: z.string().trim().min(2).max(4000),
}).superRefine((value, context) => {
  if (value.startDate > value.endDate) context.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'End date must be on or after start date' });
}).strict();

export const updateWarrantySchema = z.object({
  startDate: warrantyDates.startDate.optional(),
  endDate: warrantyDates.endDate.optional(),
  description: z.string().trim().min(2).max(4000).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' }).strict();

export const updateWarrantyStatusSchema = z.object({ status: z.nativeEnum(WarrantyStatus) }).strict();

export type CreateWarrantyInput = z.infer<typeof createWarrantySchema>;
export type UpdateWarrantyInput = z.infer<typeof updateWarrantySchema>;