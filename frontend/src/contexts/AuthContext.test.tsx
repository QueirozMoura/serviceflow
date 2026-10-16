import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('../services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../services/api')>()), api: apiMock }));

import { ApiError } from '../services/api';
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
