import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Toast } from './Toast';
import { Loading, ErrorState } from './Feedback';
import { EmptyState } from './ResourceStates';
import { MemoryRouter } from 'react-router-dom';

describe('Toast', () => {
  it('announces the message as a status and closes on request, for success and error tones', () => {
    const onClose = vi.fn();
    const { container, rerender } = render(<Toast message="Salvo." onClose={onClose} />);
    expect(screen.getByRole('status').textContent).toContain('Salvo.');
    expect(container.querySelector('.toast-success')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar mensagem' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<Toast message="Falhou." tone="error" onClose={onClose} />);
    expect(container.querySelector('.toast-error')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Falhou.');
  });
});

describe('feedback states', () => {
  it('shows a skeleton with the loading message as a status', () => {
    const { container } = render(<Loading message="Carregando clientes..." />);
    expect(screen.getByRole('status').textContent).toBe('Carregando clientes...');
    expect(container.querySelectorAll('.skeleton[aria-hidden="true"]').length).toBeGreaterThan(1);
  });

  it('offers a retry action on errors', () => {
    const retry = vi.fn();
    render(<ErrorState message="Falha." actionLabel="Tentar novamente" onAction={retry} />);
    expect(screen.getByRole('alert').textContent).toContain('Falha.');
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(retry).toHaveBeenCalled();
  });

  it('shows a decorative illustration, an explanation and a useful action when empty', () => {
    const { container } = render(<MemoryRouter><EmptyState title="Nenhum cliente" message="Cadastre o primeiro." actionLabel="Novo cliente" to="/customers/new" /></MemoryRouter>);
    expect(container.querySelector('svg.empty-art')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Nenhum cliente' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Novo cliente' }).getAttribute('href')).toBe('/customers/new');
  });
});
