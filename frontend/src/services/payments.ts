import { api } from './api';
import type { PaymentOverviewRow } from '../types/overview';
import type { PaymentInput, PaymentResponse, PaymentStatus, PaymentsResponse } from '../types/payment';

export const paymentsService = {
  /** Lista agregada (uma requisição) usada pela tela de Pagamentos; exige permissão de pagamentos. */
  listOverview: () => api.get<{ payments: PaymentOverviewRow[] }>('/api/payments'),
  list: (serviceOrderId: string) => api.get<PaymentsResponse>(`/api/service-orders/${serviceOrderId}/payments`),
  get: (serviceOrderId: string, paymentId: string) => api.get<PaymentResponse>(`/api/service-orders/${serviceOrderId}/payments/${paymentId}`),
  create: (serviceOrderId: string, input: PaymentInput) => api.post<PaymentResponse>(`/api/service-orders/${serviceOrderId}/payments`, input),
  update: (serviceOrderId: string, paymentId: string, input: Partial<PaymentInput>) => api.patch<PaymentResponse>(`/api/service-orders/${serviceOrderId}/payments/${paymentId}`, input),
  updateStatus: (serviceOrderId: string, paymentId: string, status: PaymentStatus) => api.patch<PaymentResponse>(`/api/service-orders/${serviceOrderId}/payments/${paymentId}/status`, { status }),
  remove: (serviceOrderId: string, paymentId: string) => api.delete<void>(`/api/service-orders/${serviceOrderId}/payments/${paymentId}`),
};