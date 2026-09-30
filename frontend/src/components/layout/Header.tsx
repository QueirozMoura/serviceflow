import { Menu } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import type { User } from '../../types/auth';

interface HeaderProps { user: User; onMenuClick: () => void; }

export function Header({ user, onMenuClick }: HeaderProps) {
  const location = useLocation();
  const title = location.pathname.startsWith('/customers') ? 'Clientes' : location.pathname.startsWith('/equipment') ? 'Equipamentos' : 'Dashboard';
  return (
    <header className="header">
      <button className="icon-button mobile-only" type="button" aria-label="Abrir menu" onClick={onMenuClick}><Menu size={21} /></button>
      <div><p className="eyebrow">Visão geral</p><h1>{title}</h1></div>
      <div className="header-user"><div className="avatar">{user.name.charAt(0).toUpperCase()}</div><div><strong>{user.name}</strong><span>{user.role}</span></div></div>
    </header>
  );
}
