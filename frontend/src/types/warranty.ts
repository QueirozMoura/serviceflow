export type WarrantyStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED';

export interface Warranty {
  id: string;
  organizationId: string;
  serviceOrderId: string;
  startDate: string;
  endDate: string;
  description: string;
  status: WarrantyStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WarrantyResponse { warranty: Warranty; }
export interface WarrantyInput { startDate: string; endDate: string; description: string; }
export interface WarrantyUpdate { startDate?: string; endDate?: string; description?: string; }