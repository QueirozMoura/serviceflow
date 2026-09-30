import { api } from './api';
import type { PaymentInput, PaymentResponse, PaymentStatus, PaymentsResponse } from '../types/payment';

export const paymentsService = {
  list: (serviceOrderId: string) => api.get<PaymentsResponse>(`/api/service-orders/${serviceOrderId}/payments`),
  get: (serviceOrderId: string, paymentId: string) => api.get<PaymentResponse>(`/api/service-orders/${serviceOrderId}/payments/${paymentId}`),
  create: (serviceOrderId: string, input: PaymentInput) => api.post<PaymentResponse>(`/api/service-orders/${serviceOrderId}/payments`, input),
  update: (serviceOrderId: string, paymentId: string, input: Partial<PaymentInput>) => api.patch<PaymentResponse>(`/api/service-orders/${serviceOrderId}/payments/${paymentId}`, input),
  updateStatus: (serviceOrderId: string, paymentId: string, status: PaymentStatus) => api.patch<PaymentResponse>(`/api/service-orders/${serviceOrderId}/payments/${paymentId}/status`, { status }),
  remove: (serviceOrderId: string, paymentId: string) => api.delete<void>(`/api/service-orders/${serviceOrderId}/payments/${paymentId}`),
};