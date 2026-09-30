import type { DecimalValue } from './service-order';

export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED' | 'REFUNDED';
export type PaymentMethod = 'PIX' | 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER';

export interface Payment {
  id: string;
  organizationId: string;
  serviceOrderId: string;
  amount: DecimalValue;
  status: PaymentStatus;
  method: PaymentMethod;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentResponse { payment: Payment; }
export interface PaymentsResponse { payments: Payment[]; }
export interface PaymentInput { amount: string; method: PaymentMethod; }