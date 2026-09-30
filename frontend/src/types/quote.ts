import type { DecimalValue } from './service-order';

export type QuoteStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
export type ServiceItemType = 'LABOR' | 'PART';

export interface QuoteItem {
  id: string;
  description: string;
  quantity: DecimalValue;
  unitPrice: DecimalValue;
  type: ServiceItemType;
}

export interface Quote {
  id: string;
  serviceOrderId: string;
  status: QuoteStatus;
  total: DecimalValue;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  items: QuoteItem[];
}

export interface QuoteResponse { quote: Quote; }
export interface CreateQuoteInput { notes?: string | null; }
export interface UpdateQuoteInput { notes?: string | null; }
export interface ServiceItemInput { description: string; quantity: string; unitPrice: string; type: ServiceItemType; }