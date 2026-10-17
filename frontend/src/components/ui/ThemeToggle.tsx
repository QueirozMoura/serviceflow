import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';

/** Alterna entre tema claro e escuro. O ícone mostra o tema ativo; o nome acessível descreve a ação do clique. */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === 'dark';
  return (
    <button className={`icon-button theme-toggle ${className}`.trim()} type="button" aria-label={dark ? 'Mudar para tema claro' : 'Mudar para tema escuro'} onClick={toggleTheme}>
      {dark ? <Moon size={19} aria-hidden="true" /> : <Sun size={19} aria-hidden="true" />}
    </button>
  );
}
