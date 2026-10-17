import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, LogOut, Menu, UserRound } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import type { User } from '../../types/auth';
import { ThemeToggle } from '../ui/ThemeToggle';

interface HeaderProps { user: User; onMenuClick: () => void; onLogout: () => void }

const roleLabels: Record<string, string> = { OWNER: 'Proprietário', ADMIN: 'Administrador', TECHNICIAN: 'Técnico' };

const sections: Array<{ prefix: string; eyebrow: string; title: string; noun?: [string, string, string] }> = [
  { prefix: '/dashboard', eyebrow: 'Visão geral', title: 'Dashboard' },
  { prefix: '/customers', eyebrow: 'Operação', title: 'Clientes', noun: ['Novo cliente', 'Detalhes do cliente', 'Editar cliente'] },
  { prefix: '/equipment', eyebrow: 'Operação', title: 'Equipamentos', noun: ['Novo equipamento', 'Detalhes do equipamento', 'Editar equipamento'] },
  { prefix: '/service-orders', eyebrow: 'Operação', title: 'Ordens de serviço', noun: ['Nova ordem de serviço', 'Detalhes da ordem', 'Editar ordem de serviço'] },
  { prefix: '/quotes', eyebrow: 'Operação', title: 'Orçamentos' },
  { prefix: '/payments', eyebrow: 'Operação', title: 'Pagamentos' },
  { prefix: '/warranties', eyebrow: 'Operação', title: 'Garantias' },
  { prefix: '/team', eyebrow: 'Sistema', title: 'Equipe' },
  { prefix: '/profile', eyebrow: 'Sistema', title: 'Meu perfil' },
];

/** Localiza a seção da URL e, nas subpáginas, o nome da ação (novo, detalhes, editar). */
export function describeRoute(pathname: string): { eyebrow: string; title: string; section?: string } {
  const section = sections.find((item) => pathname === item.prefix || pathname.startsWith(`${item.prefix}/`));
  if (!section) return { eyebrow: 'Visão geral', title: 'Dashboard' };
  const rest = pathname.slice(section.prefix.length).split('/').filter(Boolean);
  if (!section.noun || rest.length === 0) return { eyebrow: section.eyebrow, title: section.title };
  const title = rest[0] === 'new' ? section.noun[0] : rest[1] === 'edit' ? section.noun[2] : section.noun[1];
  return { eyebrow: section.title, title, section: section.prefix };
}

function UserMenu({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) { if (event.key === 'Escape') { setOpen(false); root.current?.querySelector('button')?.focus(); } return; }
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  return (
    <div className="user-menu" ref={root}>
      <button className="user-menu-trigger" type="button" aria-expanded={open} aria-haspopup="true" aria-controls="user-menu-panel" aria-label={`Menu da conta de ${user.name}`} onClick={() => setOpen((value) => !value)}>
        <span className="avatar">{user.name.charAt(0).toUpperCase()}</span>
        <span className="user-menu-copy"><strong>{user.name}</strong><span>{roleLabels[user.role] ?? user.role}</span></span>
        <ChevronDown className="user-menu-chevron" size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div className="menu-panel" id="user-menu-panel">
          <div className="menu-panel-head"><strong>{user.name}</strong><span>{user.email}</span></div>
          <Link className="menu-item" to="/profile"><UserRound size={16} aria-hidden="true" /> Meu perfil</Link>
          <button className="menu-item menu-item-danger" type="button" onClick={onLogout}><LogOut size={16} aria-hidden="true" /> Encerrar sessão</button>
        </div>
      ) : null}
    </div>
  );
}

export function Header({ user, onMenuClick, onLogout }: HeaderProps) {
  const { pathname } = useLocation();
  const { eyebrow, title } = describeRoute(pathname);
  // O título da página (h1) fica no conteúdo; aqui só a localização, para não duplicar cabeçalhos.
  return (
    <header className="header">
      <button className="icon-button mobile-only" type="button" aria-label="Abrir menu" onClick={onMenuClick}><Menu size={21} /></button>
      <nav className="header-title" aria-label="Você está em">
        <ol className="crumbs">
          <li>{eyebrow}</li>
          <li aria-hidden="true"><ChevronRight size={14} /></li>
          <li aria-current="page">{title}</li>
        </ol>
      </nav>
      <ThemeToggle className="header-theme" />
      <UserMenu user={user} onLogout={onLogout} />
    </header>
  );
}
