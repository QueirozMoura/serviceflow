import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { User } from '../../types/auth';
import { Sidebar } from './Sidebar';

const base: User = { id: 'user-1', name: 'Alice', email: 'alice@example.com', role: 'OWNER', organizationId: 'organization-1' };
const render_ = (user: User) => render(<MemoryRouter><Sidebar user={user} isOpen={false} onClose={vi.fn()} onLogout={vi.fn()} /></MemoryRouter>);

describe('Sidebar permissions', () => {
  it('shows the payments entry to a user allowed to read payments', () => {
    render_({ ...base, permissions: ['payments:read', 'customers:read'] });
    expect(screen.getByRole('link', { name: 'Pagamentos' }).getAttribute('href')).toBe('/payments');
    expect(screen.getByRole('link', { name: 'Clientes' })).toBeTruthy();
  });

  it('hides the payments entry from a user without payments:read, keeping the rest of the menu', () => {
    render_({ ...base, role: 'TECHNICIAN', permissions: ['customers:read', 'serviceOrders:read'] });
    expect(screen.queryByRole('link', { name: 'Pagamentos' })).toBeNull();
    for (const name of ['Dashboard', 'Clientes', 'Equipamentos', 'Ordens de serviço', 'Orçamentos', 'Garantias', 'Meu perfil']) {
      expect(screen.getByRole('link', { name })).toBeTruthy();
    }
  });

  it('does not trust the role name when the permission list is missing', () => {
    render_({ ...base, role: 'OWNER' });
    expect(screen.queryByRole('link', { name: 'Pagamentos' })).toBeNull();
  });

  it('shows the team entry only to a user allowed to read the team', () => {
    const { unmount } = render_({ ...base, permissions: ['team:read'] });
    expect(screen.getByRole('link', { name: 'Equipe' }).getAttribute('href')).toBe('/team');
    unmount();
    render_({ ...base, role: 'ADMIN', permissions: ['payments:read', 'customers:read'] });
    expect(screen.queryByRole('link', { name: 'Equipe' })).toBeNull();
  });
});
