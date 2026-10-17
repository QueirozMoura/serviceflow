// Tema da interface (claro/escuro). A preferência fica em localStorage; sem preferência salva o padrão é o tema CLARO
// (de propósito, a preferência do sistema operacional não é consultada). O mesmo valor é aplicado em <html data-theme>
// por um script no index.html ANTES da primeira pintura, para a página nunca aparecer num tema e piscar para o outro.

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'serviceflow-theme';
export const DEFAULT_THEME: Theme = 'light';
/** Cor da barra do navegador em cada tema (igual ao fundo da aplicação). */
export const THEME_COLORS: Record<Theme, string> = { light: '#f3f4f8', dark: '#0b0e14' };

export const isTheme = (value: unknown): value is Theme => value === 'light' || value === 'dark';

function readStored(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    // Armazenamento bloqueado (modo privado restrito, cookies desativados): segue sem persistir.
    return null;
  }
}

function applyToDocument(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}

function initialTheme(): Theme {
  if (typeof document === 'undefined') return DEFAULT_THEME;
  const applied = document.documentElement.dataset.theme;
  return isTheme(applied) ? applied : (readStored() ?? DEFAULT_THEME);
}

let current: Theme = initialTheme();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

if (typeof document !== 'undefined') applyToDocument(current);

// Outra aba mudou o tema: acompanha sem recarregar.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== THEME_STORAGE_KEY || !isTheme(event.newValue) || event.newValue === current) return;
    current = event.newValue;
    applyToDocument(current);
    notify();
  });
}

export const getTheme = (): Theme => current;

export function setTheme(theme: Theme): void {
  if (!isTheme(theme)) return;
  current = theme;
  applyToDocument(theme);
  try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* a troca vale para esta sessão mesmo sem persistência */ }
  notify();
}

export const toggleTheme = (): void => setTheme(current === 'dark' ? 'light' : 'dark');

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
