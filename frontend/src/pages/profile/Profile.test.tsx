import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn() }));
vi.mock('../../services/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../services/api')>()), api: apiMock }));

import { ApiError } from '../../services/api';
import { AuthProvider } from '../../contexts/AuthContext';
import { AppLayout } from '../../components/layout/AppLayout';
import { Profile } from './Profile';

const profile = { id: 'user-1', name: 'Alice Silva', email: 'alice@example.com', role: 'OWNER', organizationId: 'organization-1', organization: { id: 'organization-1', name: 'Oficina Alice' } };

function renderPage() {
  return render(<MemoryRouter initialEntries={['/profile']}><AuthProvider><Routes><Route element={<AppLayout />}><Route path="/profile" element={<Profile />} /></Route></Routes></AuthProvider></MemoryRouter>);
}
const nameInput = async () => (await screen.findByLabelText(/^Nome/)) as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: /Salvar perfil|Salvando/ }) as HTMLButtonElement;
// O nome do usuário aparece na Sidebar e no Header.
const shownNames = (name: string) => screen.getAllByText(name, { selector: 'strong' });

describe('Profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.get.mockResolvedValue({ user: profile });
  });

  it('shows the authenticated profile with protected fields read-only', async () => {
    renderPage();
    expect((await nameInput()).value).toBe('Alice Silva');
    expect(apiMock.get).toHaveBeenCalledWith('/api/auth/me');
    const email = screen.getByLabelText('E-mail') as HTMLInputElement;
    expect(email.value).toBe('alice@example.com');
    expect(email.disabled).toBe(true);
    expect((screen.getByLabelText('Papel') as HTMLInputElement).value).toBe('Proprietário');
    expect((screen.getByLabelText('Organização') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Organização') as HTMLInputElement).value).toBe('Oficina Alice');
  });

  it('keeps save disabled until the name changes', async () => {
    renderPage();
    const input = await nameInput();
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'Alice Souza' } });
    expect(saveButton().disabled).toBe(false);
    fireEvent.change(input, { target: { value: '  Alice Silva  ' } });
    expect(saveButton().disabled).toBe(true);
  });

  it.each([
    ['empty', '', 'pelo menos 2 caracteres'],
    ['blank', '   ', 'pelo menos 2 caracteres'],
    ['one character', 'A', 'pelo menos 2 caracteres'],
    ['too long', 'a'.repeat(121), 'no máximo 120 caracteres'],
  ])('validates a %s name without calling the API', async (_label, value, message) => {
    renderPage();
    fireEvent.change(await nameInput(), { target: { value } });
    fireEvent.submit(saveButton().closest('form')!);

    expect((await screen.findByRole('alert')).textContent).toContain(message);
    expect(apiMock.patch).not.toHaveBeenCalled();
  });

  it('saves only the trimmed name, then refreshes sidebar and header without a new login', async () => {
    apiMock.patch.mockResolvedValue({ user: { ...profile, name: 'Alice Souza' } });
    renderPage();
    fireEvent.change(await nameInput(), { target: { value: '  Alice Souza  ' } });
    fireEvent.click(saveButton());

    expect(await screen.findByText('Perfil atualizado.')).toBeTruthy();
    expect(apiMock.patch).toHaveBeenCalledTimes(1);
    expect(apiMock.patch).toHaveBeenCalledWith('/api/auth/me', { name: 'Alice Souza' });
    expect(shownNames('Alice Souza').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('Alice Silva', { selector: 'strong' })).toBeNull();
    expect((await nameInput()).value).toBe('Alice Souza');
    expect(saveButton().disabled).toBe(true);
    expect(apiMock.get).toHaveBeenCalledTimes(1);
    expect(apiMock.post).not.toHaveBeenCalled();
    expect((screen.getByLabelText('E-mail') as HTMLInputElement).value).toBe('alice@example.com');
  });

  it('blocks duplicate submissions while saving', async () => {
    let resolvePatch: (value: unknown) => void = () => undefined;
    apiMock.patch.mockReturnValue(new Promise((resolve) => { resolvePatch = resolve; }));
    renderPage();
    fireEvent.change(await nameInput(), { target: { value: 'Alice Souza' } });
    fireEvent.click(saveButton());

    expect(saveButton().textContent).toContain('Salvando...');
    expect(saveButton().disabled).toBe(true);
    fireEvent.submit(saveButton().closest('form')!);
    expect(apiMock.patch).toHaveBeenCalledTimes(1);

    await act(async () => { resolvePatch({ user: { ...profile, name: 'Alice Souza' } }); });
    expect(await screen.findByText('Perfil atualizado.')).toBeTruthy();
  });

  it.each([
    ['rejects the data (400)', new ApiError('Invalid profile data', 400), 'Revise o nome informado.'],
    ['expires the session (401)', new ApiError('Authentication required', 401), 'Sua sessão expirou'],
    ['fails unexpectedly', new TypeError('Failed to fetch'), 'Não foi possível salvar o perfil'],
  ])('keeps the typed value and shows an error when the API %s', async (_label, failure, message) => {
    apiMock.patch.mockRejectedValue(failure);
    renderPage();
    const input = await nameInput();
    fireEvent.change(input, { target: { value: 'Alice Souza' } });
    fireEvent.click(saveButton());

    expect((await screen.findByRole('alert')).textContent).toContain(message);
    expect(input.value).toBe('Alice Souza');
    expect(screen.queryByText('Perfil atualizado.')).toBeNull();
    expect(shownNames('Alice Silva').length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(saveButton().disabled).toBe(false));
  });

  it('clears a previous error when the user edits the name again', async () => {
    apiMock.patch.mockRejectedValue(new ApiError('Invalid profile data', 400));
    renderPage();
    const input = await nameInput();
    fireEvent.change(input, { target: { value: 'Alice Souza' } });
    fireEvent.click(saveButton());
    await screen.findByRole('alert');

    fireEvent.change(input, { target: { value: 'Alice Souza 2' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('links the profile page from the sidebar', async () => {
    renderPage();
    await nameInput();
    const link = within(screen.getByRole('navigation', { name: 'Navegação principal' })).getByRole('link', { name: 'Meu perfil' });
    expect(link.getAttribute('href')).toBe('/profile');
  });
});
