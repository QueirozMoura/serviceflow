import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Customer } from '../../types/customer';
import type { Equipment } from '../../types/equipment';
import type { ServiceOrder } from '../../types/service-order';

const customerServiceMock = vi.hoisted(() => ({ list: vi.fn(), options: vi.fn() }));
const equipmentServiceMock = vi.hoisted(() => ({ list: vi.fn(), options: vi.fn() }));
const serviceOrderServiceMock = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn(), update: vi.fn() }));
vi.mock('../../services/customers', () => ({ customersService: customerServiceMock }));
vi.mock('../../services/equipment', () => ({ equipmentService: equipmentServiceMock }));
vi.mock('../../services/service-orders', () => ({ serviceOrdersService: serviceOrderServiceMock }));

import { ServiceOrderForm } from './ServiceOrderForm';

const customer: Customer = {
  id: 'customer-1', organizationId: 'organization-1', name: 'Alice Silva', email: null, phone: '11999999999',
  document: null, address: null, notes: null, createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z',
};
const equipment: Equipment = {
  id: 'equipment-1', organizationId: 'organization-1', customerId: customer.id, type: 'Notebook', brand: 'Dell', model: 'Inspiron', serialNumber: null, description: null,
  customer: { id: customer.id, name: customer.name }, createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z',
};
const order: ServiceOrder = {
  id: 'order-1', organizationId: 'organization-1', customerId: customer.id, equipmentId: equipment.id, orderNumber: 'OS-1', status: 'RECEIVED',
  problemDescription: 'Tela não liga', technicianNotes: null, estimatedValue: '125.50', finalValue: null, receivedAt: '2026-10-15T10:00:00.000Z', completedAt: null,
  createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z', customer: { id: customer.id, name: customer.name }, equipment: { id: equipment.id, type: equipment.type, brand: equipment.brand, model: equipment.model },
};

function renderPage(path = '/service-orders/new') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/service-orders/new" element={<ServiceOrderForm />} /><Route path="/service-orders/:id/edit" element={<ServiceOrderForm />} /><Route path="/service-orders/:id" element={<div>order details</div>} /></Routes></MemoryRouter>);
}

async function fillNewOrder() {
  await screen.findByRole('option', { name: /Alice Silva/ });
  fireEvent.change(screen.getByLabelText(/Cliente/), { target: { value: 'customer-1' } });
  await screen.findByRole('option', { name: /Dell Inspiron/ });
  fireEvent.change(screen.getByLabelText(/Equipamento/), { target: { value: 'equipment-1' } });
  fireEvent.change(screen.getByLabelText(/Problema relatado/), { target: { value: 'Tela não liga' } });
}

describe('ServiceOrderForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customerServiceMock.options.mockResolvedValue({ customers: [{ id: customer.id, name: customer.name, phone: customer.phone }] });
    equipmentServiceMock.options.mockResolvedValue({ equipment: [{ id: equipment.id, customerId: equipment.customerId, type: equipment.type, brand: equipment.brand, model: equipment.model, serialNumber: equipment.serialNumber }] });
    serviceOrderServiceMock.create.mockResolvedValue({ serviceOrder: order });
    serviceOrderServiceMock.update.mockResolvedValue({ serviceOrder: order });
  });

  it('shows loading and blocks submission when required fields are missing', async () => {
    let resolveCustomers: (value: { customers: Customer[] }) => void = () => undefined;
    customerServiceMock.options.mockReturnValue(new Promise((resolve) => { resolveCustomers = resolve; }));
    renderPage();

    expect(screen.getByRole('status').textContent).toContain('Carregando formulário');
    await act(async () => { resolveCustomers({ customers: [customer] }); });
    fireEvent.submit((await screen.findByRole('button', { name: /Salvar ordem/ })).closest('form')!);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(serviceOrderServiceMock.create).not.toHaveBeenCalled();
  });

  it('normalizes Brazilian monetary input and preserves zero in the create payload', async () => {
    renderPage();
    await fillNewOrder();
    fireEvent.change(screen.getByLabelText(/Valor estimado/), { target: { value: '1.234,56' } });
    fireEvent.change(screen.getByLabelText(/Valor final/), { target: { value: '0' } });
    fireEvent.submit(screen.getByRole('button', { name: /Salvar ordem/ }).closest('form')!);

    await waitFor(() => expect(serviceOrderServiceMock.create).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'customer-1', equipmentId: 'equipment-1', estimatedValue: '1234.56', finalValue: '0' })));
  });

  it('loads and updates an existing order with normalized values', async () => {
    serviceOrderServiceMock.get.mockResolvedValue({ serviceOrder: order });
    renderPage('/service-orders/order-1/edit');

    expect(await screen.findByDisplayValue('125.50')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Valor final/), { target: { value: '250,75' } });
    fireEvent.submit(screen.getByRole('button', { name: /Salvar ordem/ }).closest('form')!);

    await waitFor(() => expect(serviceOrderServiceMock.update).toHaveBeenCalledWith('order-1', expect.objectContaining({ finalValue: '250.75' })));
  });

  it('disables the save action while a request is pending', async () => {
    let resolveCreate: (value: { serviceOrder: ServiceOrder }) => void = () => undefined;
    serviceOrderServiceMock.create.mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    renderPage();
    await fillNewOrder();
    const saveButton = screen.getByRole('button', { name: /Salvar ordem/ }) as HTMLButtonElement;
    fireEvent.click(saveButton);

    expect(saveButton.disabled).toBe(true);
    expect(serviceOrderServiceMock.create).toHaveBeenCalledTimes(1);
    resolveCreate({ serviceOrder: order });
  });

  it('fills the selectors from the complete options lists and never from the paginated lists', async () => {
    renderPage();
    await screen.findByRole('option', { name: /Alice Silva/ });
    fireEvent.change(screen.getByLabelText(/Cliente/), { target: { value: 'customer-1' } });
    await screen.findByRole('option', { name: /Dell Inspiron/ });

    expect(customerServiceMock.options).toHaveBeenCalledTimes(1);
    expect(equipmentServiceMock.options).toHaveBeenCalledWith('customer-1');
    expect(customerServiceMock.list).not.toHaveBeenCalled();
    expect(equipmentServiceMock.list).not.toHaveBeenCalled();
  });
});
