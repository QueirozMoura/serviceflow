import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiError } from '../../services/api';
import type { Customer } from '../../types/customer';

const customerServiceMock = vi.hoisted(() => ({ list: vi.fn(), remove: vi.fn() }));
vi.mock('../../services/customers', () => ({ customersService: customerServiceMock }));

import { CustomerList } from './CustomerList';

const customer: Customer = {
  id: 'customer-1', organizationId: 'organization-1', name: 'Alice Silva', email: 'alice@example.com', phone: '11999999999',
  document: null, address: null, notes: null, createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z',
};

function renderPage() {
  return render(<MemoryRouter><CustomerList /></MemoryRouter>);
}

describe('CustomerList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    customerServiceMock.remove.mockResolvedValue(undefined);
  });

  it('shows loading and then the loaded customer list', async () => {
    let resolveList: (value: { customers: Customer[] }) => void = () => undefined;
    customerServiceMock.list.mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
    renderPage();

    expect(screen.getByRole('status').textContent).toContain('Carregando clientes');
    resolveList({ customers: [customer] });
    expect(await screen.findByText('Alice Silva')).toBeTruthy();
    expect(screen.getByText('alice@example.com')).toBeTruthy();
  });

  it('shows the empty state when the API returns no customers', async () => {
    customerServiceMock.list.mockResolvedValue({ customers: [] });
    renderPage();

    expect(await screen.findByText('Nenhum cliente encontrado')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Novo cliente' }).some((link) => link.getAttribute('href') === '/customers/new')).toBe(true);
  });

  it('shows an API error with a retry action', async () => {
    customerServiceMock.list.mockRejectedValue(new Error('network failure'));
    renderPage();

    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível carregar os clientes');
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeTruthy();
  });

  it('confirms and removes a customer', async () => {
    customerServiceMock.list.mockResolvedValue({ customers: [customer] });
    renderPage();

    await screen.findByText('Alice Silva');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir Alice Silva' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Excluir cliente?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));

    await waitFor(() => expect(customerServiceMock.remove).toHaveBeenCalledWith('customer-1'));
    expect((await screen.findByRole('status')).textContent).toContain('Cliente excluído com sucesso');
  });

  it('keeps the customer and reports a conflict when deletion fails', async () => {
    customerServiceMock.list.mockResolvedValue({ customers: [customer] });
    customerServiceMock.remove.mockRejectedValue(new ApiError('Conflict', 409));
    renderPage();

    await screen.findByText('Alice Silva');
    fireEvent.click(screen.getByRole('button', { name: 'Excluir Alice Silva' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' }));

    expect((await screen.findByRole('status')).textContent).toContain('Não é possível excluir este cliente');
    expect(screen.getByText('Alice Silva')).toBeTruthy();
  });
});
