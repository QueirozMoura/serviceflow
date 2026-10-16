import type { Customer } from './customer';
import type { PageInfo } from './pagination';

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
export interface EquipmentListResponse { equipment: Equipment[]; pagination: PageInfo; }
/** Equipamentos de um cliente para seletores e telas relacionadas (sem paginação). */
export type EquipmentOption = Pick<Equipment, 'id' | 'customerId' | 'type' | 'brand' | 'model' | 'serialNumber'>;
export interface EquipmentOptionsResponse { equipment: EquipmentOption[]; }
