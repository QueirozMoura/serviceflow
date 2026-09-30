import type { Customer } from './customer';

export interface Equipment {
  id: string;
  organizationId: string;
  customerId: string;
  type: string;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  description?: string | null;
  customer: Pick<Customer, 'id' | 'name'>;
  createdAt: string;
  updatedAt: string;
}

export type EquipmentInput = Pick<Equipment, 'customerId' | 'type' | 'brand' | 'model' | 'serialNumber' | 'description'>;
export interface EquipmentResponse { equipment: Equipment; }
export interface EquipmentListResponse { equipment: Equipment[]; }
