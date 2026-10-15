import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Customer } from '../../types/customer';

const customerServiceMock = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() }));
vi.mock('../../services/customers', () => ({ customersService: customerServiceMock }));

import { CustomerForm } from './CustomerForm';

const existingCustomer: Customer = {
  id: 'customer-1', organizationId: 'organization-1', name: 'Alice Silva', email: 'alice@example.com', phone: '11999999999',
  document: '123', address: 'Rua A', notes: 'Preferência', createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z',
};

function renderPage(path = '/customers/new') {
  return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/customers/new" element={<CustomerForm />} /><Route path="/customers/:id/edit" element={<CustomerForm />} /><Route path="/customers/:id" element={<div>customer details</div>} /></Routes></MemoryRouter>);
}

describe('CustomerForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customerServiceMock.create.mockResolvedValue({ customer: existingCustomer });
    customerServiceMock.update.mockResolvedValue({ customer: existingCustomer });
  });

  it('blocks submission when required fields are missing', async () => {
    renderPage();
    fireEvent.submit(screen.getByRole('button', { name: 'Salvar cliente' }).closest('form')!);

    expect((await screen.findByRole('alert')).textContent).toContain('Informe um nome válido');
    expect(customerServiceMock.create).not.toHaveBeenCalled();
  });

  it('creates a customer with the required and filled fields', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/Nome/), { target: { value: 'Bruno Costa' } });
    fireEvent.change(screen.getByLabelText(/Telefone/), { target: { value: '11888888888' } });
    fireEvent.change(screen.getByLabelText(/E-mail/), { target: { value: 'bruno@example.com' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Salvar cliente' }).closest('form')!);

    await waitFor(() => expect(customerServiceMock.create).toHaveBeenCalledWith({ name: 'Bruno Costa', phone: '11888888888', email: 'bruno@example.com' }));
  });

  it('loads and updates an existing customer', async () => {
    customerServiceMock.get.mockResolvedValue({ customer: existingCustomer });
    renderPage('/customers/customer-1/edit');

    expect(await screen.findByDisplayValue('Alice Silva')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Telefone/), { target: { value: '11777777777' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Salvar cliente' }).closest('form')!);

    await waitFor(() => expect(customerServiceMock.update).toHaveBeenCalledWith('customer-1', expect.objectContaining({ name: 'Alice Silva', phone: '11777777777' })));
  });
});
