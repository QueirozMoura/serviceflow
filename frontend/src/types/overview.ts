import type { PageInfo } from './pagination';
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

// Totais dos cartões do topo, calculados no servidor sobre toda a organização (não dependem de busca nem de filtro).
export interface QuoteSummary { pendingCount: number; approvedTotal: string; totalValue: string; }
export interface PaymentSummary { paidTotal: string; pendingTotal: string; count: number; }
export interface WarrantySummary { active: number; expired: number; total: number; }

export interface QuotesOverviewResponse { quotes: QuoteOverviewRow[]; pagination: PageInfo; summary: QuoteSummary; }
export interface PaymentsOverviewResponse { payments: PaymentOverviewRow[]; pagination: PageInfo; summary: PaymentSummary; }
export interface WarrantiesOverviewResponse { warranties: WarrantyOverviewRow[]; pagination: PageInfo; summary: WarrantySummary; }
