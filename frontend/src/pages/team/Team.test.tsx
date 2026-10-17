import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../services/api';
import { Team } from './Team';

const teamMock = vi.hoisted(() => ({ members: vi.fn(), invitations: vi.fn(), createInvitation: vi.fn(), revokeInvitation: vi.fn() }));
vi.mock('../../services/team', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../services/team')>()), teamService: teamMock }));

const token = 'K'.repeat(43);
const members = [{ id: 'u1', name: 'Dona Ana', email: 'ana@empresa.com', role: 'OWNER', createdAt: '2026-10-01T10:00:00.000Z' }, { id: 'u2', name: 'Bruno', email: 'bruno@empresa.com', role: 'TECHNICIAN', createdAt: '2026-10-02T10:00:00.000Z' }];
const pending = { id: 'i1', email: 'novo@empresa.com', role: 'ADMIN', expiresAt: '2026-10-25T10:00:00.000Z', createdAt: '2026-10-18T10:00:00.000Z', status: 'PENDING' };

describe('Team', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    teamMock.members.mockResolvedValue({ members });
    teamMock.invitations.mockResolvedValue({ invitations: [pending] });
  });

  it('lists the members with their roles and the pending invitations', async () => {
    render(<Team />);
    expect(await screen.findByText('Dona Ana')).toBeTruthy();
    expect(screen.getByText('Proprietário')).toBeTruthy();
    expect(screen.getAllByText('Técnico').length).toBeGreaterThan(0);
    const row = screen.getByText('novo@empresa.com').closest('tr')!;
    expect(within(row).getByText('Administrador')).toBeTruthy();
  });

  it('creates an invitation and shows the full link once, explaining that no email is sent', async () => {
    teamMock.createInvitation.mockResolvedValue({ invitation: { ...pending, id: 'i2', email: 'tec@empresa.com', role: 'TECHNICIAN' }, token });
    render(<Team />);
    await screen.findByText('Dona Ana');
    expect(screen.getByText(/Nenhum email é enviado/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Email do convidado'), { target: { value: ' tec@empresa.com ' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar convite/ }));

    const link = (await screen.findByLabelText('Link do convite')) as HTMLInputElement;
    expect(teamMock.createInvitation).toHaveBeenCalledWith({ email: 'tec@empresa.com', role: 'TECHNICIAN' });
    expect(link.value).toBe(`${window.location.origin}/invite#t=${token}`);
    expect(screen.getByText(/exibido apenas agora/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar' }));
    expect(screen.queryByLabelText('Link do convite')).toBeNull();
    expect(document.body.textContent).not.toContain(token);
  });

  it('only offers roles that can be invited and sends the selected one', async () => {
    teamMock.createInvitation.mockResolvedValue({ invitation: pending, token });
    render(<Team />);
    await screen.findByText('Dona Ana');
    const options = within(screen.getByLabelText('Papel')).getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['Técnico', 'Administrador']);
    fireEvent.change(screen.getByLabelText('Papel'), { target: { value: 'ADMIN' } });
    fireEvent.change(screen.getByLabelText('Email do convidado'), { target: { value: 'adm@empresa.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar convite/ }));
    await waitFor(() => expect(teamMock.createInvitation).toHaveBeenCalledWith({ email: 'adm@empresa.com', role: 'ADMIN' }));
  });

  it('validates the email locally and explains server refusals', async () => {
    render(<Team />);
    await screen.findByText('Dona Ana');
    fireEvent.click(screen.getByRole('button', { name: /Criar convite/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/email válido/);
    expect(teamMock.createInvitation).not.toHaveBeenCalled();

    teamMock.createInvitation.mockRejectedValue(new ApiError('This person is already a member of your team', 409));
    fireEvent.change(screen.getByLabelText('Email do convidado'), { target: { value: 'bruno@empresa.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar convite/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/já faz parte da sua equipe/));
    expect(screen.queryByLabelText('Link do convite')).toBeNull();
  });

  it('revokes a pending invitation and removes it from the list', async () => {
    teamMock.revokeInvitation.mockResolvedValue(undefined);
    render(<Team />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revogar convite de novo@empresa.com' }));
    await waitFor(() => expect(screen.queryByText('novo@empresa.com')).toBeNull());
    expect(teamMock.revokeInvitation).toHaveBeenCalledWith('i1');
    expect(await screen.findByText('Convite revogado.')).toBeTruthy();
  });

  it('shows an error state with retry when the team cannot be loaded', async () => {
    teamMock.members.mockRejectedValueOnce(new ApiError('x', 500));
    render(<Team />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Não foi possível carregar a equipe/);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Dona Ana')).toBeTruthy();
  });
});
