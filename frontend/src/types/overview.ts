import type { PaymentMethod, PaymentStatus } from './payment';
import type { QuoteStatus } from './quote';
import type { DecimalValue } from './service-order';
import type { WarrantyStatus } from './warranty';

// Listagens agregadas (GET /api/quotes, /api/payments, /api/warranties): só os campos que as telas exibem.
export interface OverviewOrder { id: string; orderNumber: string; customer: { name: string } }

export interface QuoteOverviewRow {
  serviceOrder: OverviewOrder;
  quote: { id: string; status: QuoteStatus; total: DecimalValue; itemsCount: number; updatedAt: string };
}

export interface PaymentOverviewRow {
  serviceOrder: OverviewOrder;
  payments: Array<{ id: string; amount: DecimalValue; status: PaymentStatus; method: PaymentMethod; updatedAt: string }>;
}

export interface WarrantyOverviewRow {
  serviceOrder: OverviewOrder;
  warranty: { id: string; status: WarrantyStatus; startDate: string; endDate: string; description: string; updatedAt: string };
}
