import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('../services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/api')>()), api: apiMock }));

import { ApiError } from '../services/api';
import { loadPendingPayment, savePendingPayment } from '../utils/pendingPayment';
import { AuthProvider, useAuth } from './AuthContext';

function Probe() {
  const { can, isLoading } = useAuth();
  if (isLoading) return <p>loading</p>;
  return <ul>{['customers:write', 'customers:delete', 'payments:read'].map((permission) => <li key={permission}>{permission}={String(can(permission))}</li>)}</ul>;
}
const renderProbe = () => render(<MemoryRouter initialEntries={['/dashboard']}><AuthProvider><Probe /></AuthProvider></MemoryRouter>);
const user = { id: 'user-1', name: 'Tec', email: 'tec@example.com', role: 'TECHNICIAN', organizationId: 'organization-1' };

describe('AuthContext.can', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes the permissions returned by the server and denies the rest', async () => {
    apiMock.get.mockResolvedValue({ user: { ...user, permissions: ['customers:write', 'customers:read'] } });
    renderProbe();
    expect(await screen.findByText('customers:write=true')).toBeTruthy();
    expect(screen.getByText('customers:delete=false')).toBeTruthy();
    expect(screen.getByText('payments:read=false')).toBeTruthy();
  });

  it('denies everything when the session is not authenticated', async () => {
    apiMock.get.mockRejectedValue(new ApiError('Authentication required', 401));
    renderProbe();
    expect(await screen.findByText('customers:write=false')).toBeTruthy();
    expect(screen.getByText('payments:read=false')).toBeTruthy();
  });

  it('denies everything when the server sends no permission list, even for an OWNER', async () => {
    apiMock.get.mockResolvedValue({ user: { ...user, role: 'OWNER' } });
    renderProbe();
    expect(await screen.findByText('customers:write=false')).toBeTruthy();
  });
});

describe('AuthContext.logout and pending payments', () => {
  const pending = { key: 'pending-key-0001', amount: '50', method: 'PIX' as const, createdAt: Date.now() };
  const storageKey = (orderId: string) => `serviceflow:pending-payment:${orderId}`;

  function LogoutProbe() {
    const { isAuthenticated, isLoading, logout, can } = useAuth();
    if (isLoading) return <p>loading</p>;
    return <div><p>authenticated={String(isAuthenticated)}</p><p>payments:read={String(can('payments:read'))}</p><button onClick={() => void logout().catch(() => undefined)}>sair</button></div>;
  }
  const renderLogout = () => render(<MemoryRouter initialEntries={['/dashboard']}><AuthProvider><LogoutProbe /></AuthProvider></MemoryRouter>);

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    apiMock.get.mockResolvedValue({ user: { ...user, role: 'OWNER', permissions: ['payments:read'] } });
  });

  it('removes every persisted pending payment (storage and in-memory mirror) and ends the session, leaving unrelated keys alone', async () => {
    apiMock.post.mockResolvedValue(undefined);
    savePendingPayment('order-1', pending); savePendingPayment('order-2', { ...pending, key: 'pending-key-0002' });
    window.sessionStorage.setItem('unrelated', 'keep');
    expect(window.sessionStorage.getItem(storageKey('order-1'))).not.toBeNull();

    renderLogout();
    expect(await screen.findByText('authenticated=true')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'sair' }));

    expect(await screen.findByText('authenticated=false')).toBeTruthy();
    expect(screen.getByText('payments:read=false')).toBeTruthy();
    expect(apiMock.post).toHaveBeenCalledWith('/api/auth/logout');
    expect(window.sessionStorage.getItem(storageKey('order-1'))).toBeNull();
    expect(window.sessionStorage.getItem(storageKey('order-2'))).toBeNull();
    // loadPendingPayment consulta primeiro o espelho em memoria: null aqui prova que ele tambem foi limpo.
    expect(loadPendingPayment('order-1')).toBeNull();
    expect(loadPendingPayment('order-2')).toBeNull();
    expect(window.sessionStorage.getItem('unrelated')).toBe('keep');
  });

  it('still clears the pending payments and the session when the logout request fails', async () => {
    apiMock.post.mockRejectedValue(new ApiError('Server error', 500));
    savePendingPayment('order-1', pending);

    renderLogout();
    fireEvent.click(await screen.findByRole('button', { name: 'sair' }));

    await waitFor(() => expect(screen.getByText('authenticated=false')).toBeTruthy());
    expect(window.sessionStorage.getItem(storageKey('order-1'))).toBeNull();
    expect(loadPendingPayment('order-1')).toBeNull();
  });

  it('keeps the pending payment while the user stays logged in', async () => {
    savePendingPayment('order-1', pending);
    renderLogout();
    expect(await screen.findByText('authenticated=true')).toBeTruthy();
    expect(loadPendingPayment('order-1')).toEqual(pending);
    expect(window.sessionStorage.getItem(storageKey('order-1'))).not.toBeNull();
  });
});
