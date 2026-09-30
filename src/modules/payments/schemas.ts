import { PaymentMethod, PaymentStatus } from '@prisma/client';
import { z } from 'zod';

const amount = z
  .union([z.string(), z.number()])
  .refine((value) => /^\d+(\.\d{1,2})?$/.test(String(value)) && Number(value) > 0, 'Invalid payment amount')
  .transform(String);

export const createPaymentSchema = z.object({
  amount,
  method: z.nativeEnum(PaymentMethod),
}).strict();

export const updatePaymentSchema = z.object({
  amount: amount.optional(),
  method: z.nativeEnum(PaymentMethod).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' }).strict();

export const updatePaymentStatusSchema = z.object({ status: z.nativeEnum(PaymentStatus) }).strict();

export const paymentStatusQuerySchema = z.object({ status: z.nativeEnum(PaymentStatus).optional() }).strict();

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type UpdatePaymentInput = z.infer<typeof updatePaymentSchema>;