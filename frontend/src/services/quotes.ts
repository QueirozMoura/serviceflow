import { api } from './api';
import type { QuoteOverviewRow } from '../types/overview';
import type { CreateQuoteInput, QuoteResponse, QuoteStatus, ServiceItemInput, UpdateQuoteInput } from '../types/quote';

export const quotesService = {
  /** Lista agregada (uma requisição) usada pela tela de Orçamentos. */
  listOverview: () => api.get<{ quotes: QuoteOverviewRow[] }>('/api/quotes'),
  create: (serviceOrderId: string, input: CreateQuoteInput = {}) => api.post<QuoteResponse>(`/api/service-orders/${serviceOrderId}/quote`, input),
  get: (serviceOrderId: string) => api.get<QuoteResponse>(`/api/service-orders/${serviceOrderId}/quote`),
  update: (serviceOrderId: string, input: UpdateQuoteInput) => api.patch<QuoteResponse>(`/api/service-orders/${serviceOrderId}/quote`, input),
  updateStatus: (serviceOrderId: string, status: QuoteStatus) => api.patch<QuoteResponse>(`/api/service-orders/${serviceOrderId}/quote/status`, { status }),
  remove: (serviceOrderId: string) => api.delete<void>(`/api/service-orders/${serviceOrderId}/quote`),
  addItem: (serviceOrderId: string, input: ServiceItemInput) => api.post<QuoteResponse>(`/api/service-orders/${serviceOrderId}/quote/items`, input),
  updateItem: (serviceOrderId: string, itemId: string, input: Partial<ServiceItemInput>) => api.patch<QuoteResponse>(`/api/service-orders/${serviceOrderId}/quote/items/${itemId}`, input),
  removeItem: (serviceOrderId: string, itemId: string) => api.delete<QuoteResponse>(`/api/service-orders/${serviceOrderId}/quote/items/${itemId}`),
};