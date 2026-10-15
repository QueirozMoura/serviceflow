import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Customer } from '../../types/customer';
import type { Equipment } from '../../types/equipment';

const equipmentServiceMock = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() }));
const customerServiceMock = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../services/equipment', () => ({ equipmentService: equipmentServiceMock }));
vi.mock('../../services/customers', () => ({ customersService: customerServiceMock }));

import { EquipmentForm } from './EquipmentForm';

const customer: Customer = {
  id: 'customer-1', organizationId: 'organization-1', name: 'Alice Silva', email: null, phone: '11999999999',
  document: null, address: null, notes: null, createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z',
};
const equipment: Equipment = {
  id: 'equipment-1', organizationId: 'organization-1', customerId: 'customer-1', type: 'Notebook', brand: 'Dell', model: 'Inspiron', serialNumber: 'SN-1', description: 'Uso administrativo',
  customer: { id: customer.id, name: customer.name }, createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z',
};

function renderPage(path = '/equipment/new') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/equipment/new" element={<EquipmentForm />} /><Route path="/equipment/:id/edit" element={<EquipmentForm />} /><Route path="/equipment/:id" element={<div>equipment details</div>} /></Routes></MemoryRouter>);
}

describe('EquipmentForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customerServiceMock.list.mockResolvedValue({ customers: [customer] });
    equipmentServiceMock.list.mockResolvedValue({ equipment: [] });
    equipmentServiceMock.create.mockResolvedValue({ equipment });
    equipmentServiceMock.update.mockResolvedValue({ equipment });
  });

  it('requires a customer and equipment type before creating', async () => {
    renderPage();
    await screen.findByLabelText(/Cliente/);
    fireEvent.submit(screen.getByRole('button', { name: 'Salvar equipamento' }).closest('form')!);

    expect((await screen.findByRole('alert')).textContent).toContain('Selecione um cliente');
    expect(equipmentServiceMock.create).not.toHaveBeenCalled();
  });

  it('creates equipment with the selected customer association', async () => {
    renderPage();
    await screen.findByLabelText(/Cliente/);
    await screen.findByRole('option', { name: /Alice Silva/ });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'customer-1' } });
    fireEvent.change(screen.getByLabelText(/Tipo/), { target: { value: 'Notebook' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Salvar equipamento' }).closest('form')!);

    await waitFor(() => expect(equipmentServiceMock.create).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'customer-1', type: 'Notebook' })));
  });

  it('loads and updates an existing equipment record', async () => {
    customerServiceMock.list.mockResolvedValue({ customers: [customer] });
    equipmentServiceMock.get.mockResolvedValue({ equipment });
    equipmentServiceMock.list.mockResolvedValue({ equipment });
    renderPage('/equipment/equipment-1/edit');

    expect(await screen.findByDisplayValue('Dell')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Modelo/), { target: { value: 'Latitude' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Salvar equipamento' }).closest('form')!);

    await waitFor(() => expect(equipmentServiceMock.update).toHaveBeenCalledWith('equipment-1', expect.objectContaining({ customerId: 'customer-1', model: 'Latitude' })));
  });
});
