import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Pagination } from './Pagination';

const base = { noun: ['cliente', 'clientes'] as [string, string], onPageChange: vi.fn() };
const button = (name: RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('Pagination', () => {
  it('shows the range, the page and the total, disabling "previous" on the first page', () => {
    render(<Pagination {...base} pagination={{ page: 1, pageSize: 20, total: 45, totalPages: 3 }} shown={20} />);
    expect(screen.getByText('Mostrando 1–20 de 45 clientes')).toBeTruthy();
    expect(screen.getByText('Página 1 de 3')).toBeTruthy();
    expect(button(/Anterior/).disabled).toBe(true);
    expect(button(/Próxima/).disabled).toBe(false);
  });

  it('disables "next" on the last page and uses the count actually shown', () => {
    render(<Pagination {...base} pagination={{ page: 3, pageSize: 20, total: 45, totalPages: 3 }} shown={5} />);
    expect(screen.getByText('Mostrando 41–45 de 45 clientes')).toBeTruthy();
    expect(button(/Próxima/).disabled).toBe(true);
    expect(button(/Anterior/).disabled).toBe(false);
  });

  it('uses the singular for one record and handles an empty result', () => {
    const { unmount } = render(<Pagination {...base} pagination={{ page: 1, pageSize: 20, total: 1, totalPages: 1 }} shown={1} />);
    expect(screen.getByText('Mostrando 1–1 de 1 cliente')).toBeTruthy();
    expect(button(/Anterior/).disabled).toBe(true);
    expect(button(/Próxima/).disabled).toBe(true);
    unmount();

    render(<Pagination {...base} pagination={{ page: 1, pageSize: 20, total: 0, totalPages: 0 }} shown={0} />);
    expect(screen.getByText('0 clientes')).toBeTruthy();
    expect(screen.getByText('Página 1 de 1')).toBeTruthy();
  });

  it('asks for the adjacent pages', () => {
    const onPageChange = vi.fn();
    render(<Pagination {...base} onPageChange={onPageChange} pagination={{ page: 2, pageSize: 20, total: 45, totalPages: 3 }} shown={20} />);
    fireEvent.click(button(/Próxima/));
    fireEvent.click(button(/Anterior/));
    expect(onPageChange.mock.calls).toEqual([[3], [1]]);
  });

  it('disables both controls while loading', () => {
    render(<Pagination {...base} loading pagination={{ page: 2, pageSize: 20, total: 45, totalPages: 3 }} shown={20} />);
    expect(button(/Anterior/).disabled).toBe(true);
    expect(button(/Próxima/).disabled).toBe(true);
  });
});
