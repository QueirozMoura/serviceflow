import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const authMock = vi.hoisted(() => ({ allowed: new Set<string>() }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ can: (permission: string) => authMock.allowed.has(permission) }) }));

import { RequirePermission } from './ProtectedRoute';

const renderRoute = () => render(<MemoryRouter initialEntries={['/payments']}><Routes><Route element={<RequirePermission permission="payments:read" />}><Route path="/payments" element={<div>Tela de pagamentos</div>} /></Route></Routes></MemoryRouter>);

describe('RequirePermission', () => {
  beforeEach(() => authMock.allowed.clear());

  it('renders the page when the permission is granted', () => {
    authMock.allowed.add('payments:read');
    renderRoute();
    expect(screen.getByText('Tela de pagamentos')).toBeTruthy();
  });

  it('shows a permission message instead of the page otherwise', () => {
    renderRoute();
    expect(screen.queryByText('Tela de pagamentos')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Você não tem permissão');
  });
});
