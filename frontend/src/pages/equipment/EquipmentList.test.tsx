import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Customer } from '../../types/customer';
import type { Equipment } from '../../types/equipment';

const equipmentServiceMock = vi.hoisted(() => ({ list: vi.fn(), remove: vi.fn() }));
const customerServiceMock = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../services/equipment', () => ({ equipmentService: equipmentServiceMock }));
vi.mock('../../services/customers', () => ({ customersService: customerServiceMock }));

import { EquipmentList } from './EquipmentList';

const customer: Customer = {
  id: 'customer-1', organizationId: 'organization-1', name: 'Alice Silva', email: 'alice@example.com', phone: '11999999999',
  document: null, address: null, notes: null, createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z',
};
const equipment: Equipment = {
  id: 'equipment-1', organizationId: 'organization-1', customerId: 'customer-1', type: 'Notebook', brand: 'Dell', model: 'Inspiron', serialNumber: 'SN-1', description: null,
  customer: { id: customer.id, name: customer.name }, createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z',
};

function renderPage() {
  return render(<MemoryRouter><EquipmentList /></MemoryRouter>);
}

describe('EquipmentList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customerServiceMock.list.mockResolvedValue({ customers: [customer] });
    equipmentServiceMock.list.mockResolvedValue({ equipment: [equipment] });
  });

  it('loads equipment and exposes its customer relationship', async () => {
    renderPage();

    expect(screen.getByRole('status')).toBeTruthy();
    expect(await screen.findByText('Dell Inspiron')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Alice Silva' })).toBeTruthy();
  });

  it('reloads the list when filtering by customer', async () => {
    renderPage();
    await screen.findByText('Dell Inspiron');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'customer-1' } });

    await waitFor(() => expect(equipmentServiceMock.list).toHaveBeenLastCalledWith('customer-1'));
  });

  it('shows an API error and retry action', async () => {
    equipmentServiceMock.list.mockRejectedValue(new Error('network failure'));
    renderPage();

    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível carregar os equipamentos');
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy();
  });
});
