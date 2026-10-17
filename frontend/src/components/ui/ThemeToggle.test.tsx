import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { setTheme } from '../../utils/theme';
import { ThemeToggle } from './ThemeToggle';

describe('ThemeToggle', () => {
  beforeEach(() => { window.localStorage.clear(); act(() => setTheme('light')); window.localStorage.clear(); });

  it('shows the sun in the light theme and names the action it will perform', () => {
    const { container } = render(<ThemeToggle />);
    const button = screen.getByRole('button', { name: 'Mudar para tema escuro' });
    expect(button.querySelector('.lucide-sun')).toBeTruthy();
    expect(container.querySelector('.lucide-moon')).toBeNull();
  });

  it('switches to dark on click, instantly, updating the document and the saved preference', () => {
    const { container } = render(<ThemeToggle />);
    fireEvent.click(screen.getByRole('button', { name: 'Mudar para tema escuro' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem('serviceflow-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Mudar para tema claro' }).querySelector('.lucide-moon')).toBeTruthy();
    expect(container.querySelector('.lucide-sun')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mudar para tema claro' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(window.localStorage.getItem('serviceflow-theme')).toBe('light');
  });

  it('keeps every toggle on the page in sync and is keyboard operable', () => {
    render(<><ThemeToggle /><ThemeToggle className="extra" /></>);
    const [first, second] = screen.getAllByRole('button');
    expect(second!.className).toContain('extra');
    fireEvent.click(first!);
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Mudar para tema claro', 'Mudar para tema claro']);
    expect(first!.tagName).toBe('BUTTON');
    expect(first!.getAttribute('type')).toBe('button');
  });
});
