export type ServiceOrderStatus = 'RECEIVED' | 'WAITING_DIAGNOSIS' | 'WAITING_APPROVAL' | 'APPROVED' | 'IN_PROGRESS' | 'READY' | 'DELIVERED' | 'CANCELLED';
export type MessageType = 'SERVICE_RECEIVED' | 'DIAGNOSIS_READY' | 'QUOTE_READY' | 'QUOTE_APPROVED' | 'SERVICE_IN_PROGRESS' | 'SERVICE_READY' | 'SERVICE_DELIVERED' | 'WARRANTY_CREATED';
export type DecimalValue = string | number;

export interface ServiceOrder {
  id: string;
  organizationId: string;
  customerId: string;
  equipmentId: string;
  orderNumber: string;
  status: ServiceOrderStatus;
  problemDescription: string;
  technicianNotes?: string | null;
  estimatedValue?: DecimalValue | null;
  finalValue?: DecimalValue | null;
  receivedAt: string;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  customer: { id: string; name: string };
  equipment: { id: string; type: string; brand?: string | null; model?: string | null };
}

export interface ServiceOrderInput {
  customerId: string;
  equipmentId: string;
  problemDescription: string;
  technicianNotes?: string | null;
  estimatedValue?: string | null;
  finalValue?: string | null;
}
export type ServiceOrderUpdate = Partial<ServiceOrderInput>;
export interface ServiceOrdersResponse { serviceOrders: ServiceOrder[]; }
export interface ServiceOrderResponse { serviceOrder: ServiceOrder; }

export interface Diagnosis { id: string; serviceOrderId: string; description: string; estimatedCost?: DecimalValue | null; createdAt: string; updatedAt: string; }
export interface MessageResponse { type: MessageType; serviceOrderId: string; customer: { name: string }; phone: string; message: string; }
export interface DiagnosisResponse { diagnosis: Diagnosis; }
export type { Quote, QuoteItem, QuoteResponse, QuoteStatus, ServiceItemType } from './quote';
export type { Payment, PaymentMethod, PaymentResponse, PaymentStatus, PaymentsResponse } from './payment';
export type { Warranty, WarrantyResponse, WarrantyStatus } from './warranty';
