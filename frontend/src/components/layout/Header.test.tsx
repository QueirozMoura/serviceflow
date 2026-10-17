import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { User } from '../../types/auth';
import { Header, describeRoute } from './Header';

const user: User = { id: 'u1', name: 'Marina Costa', email: 'marina@example.com', role: 'OWNER', organizationId: 'o1' };
const renderHeader = (path = '/dashboard', onLogout = vi.fn()) => render(<MemoryRouter initialEntries={[path]}><Header user={user} onMenuClick={vi.fn()} onLogout={onLogout} /></MemoryRouter>);

describe('describeRoute', () => {
  it('names the section and, on sub-pages, the action', () => {
    expect(describeRoute('/dashboard')).toEqual({ eyebrow: 'Visão geral', title: 'Dashboard' });
    expect(describeRoute('/service-orders')).toEqual({ eyebrow: 'Operação', title: 'Ordens de serviço' });
    expect(describeRoute('/service-orders/new')).toMatchObject({ eyebrow: 'Ordens de serviço', title: 'Nova ordem de serviço' });
    expect(describeRoute('/service-orders/abc')).toMatchObject({ title: 'Detalhes da ordem' });
    expect(describeRoute('/service-orders/abc/edit')).toMatchObject({ title: 'Editar ordem de serviço' });
    expect(describeRoute('/customers/new')).toMatchObject({ title: 'Novo cliente' });
    expect(describeRoute('/equipment/9/edit')).toMatchObject({ title: 'Editar equipamento' });
    expect(describeRoute('/payments')).toEqual({ eyebrow: 'Operação', title: 'Pagamentos' });
    expect(describeRoute('/team')).toEqual({ eyebrow: 'Sistema', title: 'Equipe' });
    expect(describeRoute('/profile')).toEqual({ eyebrow: 'Sistema', title: 'Meu perfil' });
  });

  it('falls back to the dashboard for an unknown path and does not confuse similar prefixes', () => {
    expect(describeRoute('/algo-desconhecido')).toEqual({ eyebrow: 'Visão geral', title: 'Dashboard' });
    expect(describeRoute('/customers-old')).toEqual({ eyebrow: 'Visão geral', title: 'Dashboard' });
  });
});

describe('Header', () => {
  it('shows where the user is as a breadcrumb, without adding a second page heading', () => {
    renderHeader('/service-orders/new');
    const crumbs = screen.getByRole('navigation', { name: 'Você está em' });
    expect(crumbs.textContent).toContain('Ordens de serviço');
    expect(crumbs.querySelector('[aria-current="page"]')?.textContent).toBe('Nova ordem de serviço');
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('opens the account menu with profile and sign-out, and closes it with Escape or an outside click', () => {
    const onLogout = vi.fn();
    renderHeader('/dashboard', onLogout);
    const trigger = screen.getByRole('button', { name: 'Menu da conta de Marina Costa' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: /Meu perfil/ })).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: /Meu perfil/ }).getAttribute('href')).toBe('/profile');
    expect(screen.getByText('marina@example.com')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('link', { name: /Meu perfil/ })).toBeNull();

    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('link', { name: /Meu perfil/ })).toBeNull();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: /Encerrar sessão/ }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('translates the role and offers the mobile menu button', () => {
    renderHeader();
    expect(screen.getByText('Proprietário')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abrir menu' })).toBeTruthy();
  });
});
