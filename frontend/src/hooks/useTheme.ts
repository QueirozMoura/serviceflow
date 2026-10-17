import { useSyncExternalStore } from 'react';
import { DEFAULT_THEME, getTheme, setTheme, subscribeTheme, toggleTheme, type Theme } from '../utils/theme';

/** Tema atual e ações. Não exige provedor: o estado vive em utils/theme e todos os componentes o acompanham. */
export function useTheme(): { theme: Theme; setTheme: (theme: Theme) => void; toggleTheme: () => void } {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => DEFAULT_THEME);
  return { theme, setTheme, toggleTheme };
}
