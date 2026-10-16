import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '../../services/api';

const customersMock = vi.hoisted(() => ({ get: vi.fn(), remove: vi.fn() }));
const equipmentMock = vi.hoisted(() => ({ list: vi.fn(), options: vi.fn() }));
vi.mock('../../services/customers', () => ({ customersService: customersMock }));
vi.mock('../../services/equipment', () => ({ equipmentService: equipmentMock }));
const authMock = vi.hoisted(() => ({ denied: new Set<string>() }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ can: (permission: string) => !authMock.denied.has(permission) }) }));

import { CustomerDetails } from './CustomerDetails';

const customer = { id: 'customer-1', organizationId: 'org-1', name: 'Alice Silva', email: 'alice@example.com', phone: '5511999999999', document: null, address: null, notes: null, createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z' };
const option = { id: 'equipment-1', customerId: 'customer-1', type: 'Notebook', brand: 'Dell', model: 'Inspiron', serialNumber: 'SN-1' };
const renderPage = () => render(<MemoryRouter initialEntries={['/customers/customer-1']}><Routes><Route path="/customers/:id" element={<CustomerDetails />} /><Route path="/customers" element={<div>Lista de clientes</div>} /></Routes></MemoryRouter>);

describe('CustomerDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.denied.clear();
    customersMock.get.mockResolvedValue({ customer });
    equipmentMock.options.mockResolvedValue({ equipment: [option] });
  });

  it('shows the customer and the customer equipment from the lightweight options endpoint, never the paginated list', async () => {
    renderPage();

    expect(await screen.findByText('Dell Inspiron')).toBeTruthy();
    expect(screen.getByText('Notebook · S/N SN-1')).toBeTruthy();
    expect(equipmentMock.options).toHaveBeenCalledWith('customer-1');
    expect(equipmentMock.list).not.toHaveBeenCalled();
    expect(customersMock.get).toHaveBeenCalledWith('customer-1');
  });

  it('shows the empty message when the customer has no equipment', async () => {
    equipmentMock.options.mockResolvedValue({ equipment: [] });
    renderPage();
    expect(await screen.findByText('Nenhum equipamento vinculado.')).toBeTruthy();
  });

  it('shows an error with a way back when loading fails', async () => {
    customersMock.get.mockRejectedValue(new ApiError('Not found', 404));
    renderPage();
    expect((await screen.findByRole('alert')).textContent).toContain('Cliente não encontrado');
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    await waitFor(() => expect(screen.getByText('Lista de clientes')).toBeTruthy());
  });
});
