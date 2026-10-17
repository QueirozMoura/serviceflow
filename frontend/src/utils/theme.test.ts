import { beforeEach, describe, expect, it, vi } from 'vitest';
import html from '../../index.html?raw';

const KEY = 'serviceflow-theme';

async function loadTheme() {
  vi.resetModules();
  return import('./theme');
}
const root = () => document.documentElement;
const metaColor = () => document.querySelector('meta[name="theme-color"]')?.getAttribute('content');

describe('theme store', () => {
  beforeEach(() => {
    window.localStorage.clear();
    root().removeAttribute('data-theme');
    root().style.colorScheme = '';
    document.head.innerHTML = '<meta name="theme-color" content="#f3f4f8" />';
    vi.restoreAllMocks();
  });

  it('defaults to the LIGHT theme when there is no saved preference, ignoring the OS preference', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const theme = await loadTheme();
    expect(theme.getTheme()).toBe('light');
    expect(root().dataset.theme).toBe('light');
    expect(window.localStorage.getItem(KEY)).toBeNull();
    vi.unstubAllGlobals();
  });

  it('restores a saved preference on load', async () => {
    window.localStorage.setItem(KEY, 'dark');
    const theme = await loadTheme();
    expect(theme.getTheme()).toBe('dark');
    expect(root().dataset.theme).toBe('dark');
    expect(root().style.colorScheme).toBe('dark');
    expect(metaColor()).toBe(theme.THEME_COLORS.dark);
  });

  it('trusts the theme the inline script already applied before the first paint', async () => {
    root().dataset.theme = 'dark';
    const theme = await loadTheme();
    expect(theme.getTheme()).toBe('dark');
  });

  it('ignores an invalid saved value and falls back to light', async () => {
    window.localStorage.setItem(KEY, 'roxo');
    const theme = await loadTheme();
    expect(theme.getTheme()).toBe('light');
    expect(root().dataset.theme).toBe('light');
  });

  it('keeps working, without persisting, when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const theme = await loadTheme();
    expect(theme.getTheme()).toBe('light');
    expect(() => theme.setTheme('dark')).not.toThrow();
    expect(theme.getTheme()).toBe('dark');
    expect(root().dataset.theme).toBe('dark');
  });

  it('applies, persists and announces a change instantly, and toggles back', async () => {
    const theme = await loadTheme();
    const listener = vi.fn();
    const unsubscribe = theme.subscribeTheme(listener);
    theme.setTheme('dark');
    expect(root().dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(KEY)).toBe('dark');
    expect(metaColor()).toBe(theme.THEME_COLORS.dark);
    expect(listener).toHaveBeenCalledTimes(1);
    theme.toggleTheme();
    expect(theme.getTheme()).toBe('light');
    expect(window.localStorage.getItem(KEY)).toBe('light');
    expect(metaColor()).toBe(theme.THEME_COLORS.light);
    unsubscribe();
    theme.toggleTheme();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('rejects values that are not a theme', async () => {
    const theme = await loadTheme();
    theme.setTheme('neon' as never);
    expect(theme.getTheme()).toBe('light');
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('follows a change made in another tab, and ignores unrelated or invalid storage events', async () => {
    const theme = await loadTheme();
    const listener = vi.fn();
    theme.subscribeTheme(listener);
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'dark' }));
    expect(theme.getTheme()).toBe('dark');
    expect(root().dataset.theme).toBe('dark');
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent('storage', { key: 'outra-chave', newValue: 'light' }));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'invalido' }));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY, newValue: 'dark' }));
    expect(theme.getTheme()).toBe('dark');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// O script de index.html roda antes da primeira pintura: aqui o executamos de verdade, com um DOM mínimo.
describe('inline script in index.html (no flash of the wrong theme)', () => {
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';

  function run(stored: string | null | 'throws') {
    const attributes: Record<string, string> = {};
    const style: Record<string, string> = {};
    const meta = { content: '', setAttribute: (_name: string, value: string) => { meta.content = value; } };
    const win = { localStorage: { getItem: () => { if (stored === 'throws') throw new Error('blocked'); return stored; } } };
    const doc = { documentElement: { setAttribute: (name: string, value: string) => { attributes[name] = value; }, style }, querySelector: () => meta };
    new Function('window', 'document', script)(win, doc);
    return { theme: attributes['data-theme'], colorScheme: style.colorScheme, color: meta.content };
  }

  it('exists, is synchronous and runs in <head> before the app bundle', () => {
    expect(script.length).toBeGreaterThan(50);
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('type="module"'));
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('<div id="root">'));
  });

  it('applies light with no preference, dark when saved, and light for anything else', () => {
    expect(run(null)).toEqual({ theme: 'light', colorScheme: 'light', color: '#f3f4f8' });
    expect(run('dark')).toEqual({ theme: 'dark', colorScheme: 'dark', color: '#0b0e14' });
    expect(run('light')).toEqual({ theme: 'light', colorScheme: 'light', color: '#f3f4f8' });
    expect(run('qualquer')).toMatchObject({ theme: 'light' });
    expect(run('throws')).toMatchObject({ theme: 'light' });
  });

  it('uses the same storage key and colors as the application code', async () => {
    const theme = await loadTheme();
    expect(script).toContain(`'${theme.THEME_STORAGE_KEY}'`);
    expect(script).toContain(theme.THEME_COLORS.light);
    expect(script).toContain(theme.THEME_COLORS.dark);
  });
});
