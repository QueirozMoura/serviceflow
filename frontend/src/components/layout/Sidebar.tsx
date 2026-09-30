import {
  BadgeDollarSign,
  Boxes,
  ClipboardList,
  FileText,
  LayoutDashboard,
  LogOut,
  Settings,
  ShieldCheck,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import type { User } from '../../types/auth';

interface SidebarProps {
  user: User;
  isOpen: boolean;
  onClose: () => void;
  onLogout: () => void;
}

const groups = [
  {
    label: 'Principal',
    items: [{ label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard' }],
  },
  {
    label: 'Operação',
    items: [
      { label: 'Clientes', icon: Users, to: '/customers' },
      { label: 'Equipamentos', icon: Boxes, to: '/equipment' },
      { label: 'Ordens de serviço', icon: ClipboardList, to: '/service-orders' },
      { label: 'Orçamentos', icon: FileText },
      { label: 'Pagamentos', icon: BadgeDollarSign },
      { label: 'Garantias', icon: ShieldCheck },
    ],
  },
  {
    label: 'Sistema',
    items: [{ label: 'Configurações', icon: Settings }],
  },
];

type NavigationItem = { label: string; icon: typeof LayoutDashboard; to?: string };

export function Sidebar({ user, isOpen, onClose, onLogout }: SidebarProps) {
  return (
    <>
      {isOpen ? <button className="sidebar-overlay" type="button" aria-label="Fechar menu" onClick={onClose} /> : null}
      <aside className={`sidebar ${isOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark"><Wrench size={19} /></div>
          <span>Service<span>Flow</span></span>
          <button className="icon-button mobile-only" type="button" aria-label="Fechar menu" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <nav className="sidebar-nav" aria-label="Navegação principal">
          {groups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p className="nav-label">{group.label}</p>
              {group.items.map((item: NavigationItem) => {
                const Icon = item.icon;
                return item.to ? (
                  <NavLink className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`} end to={item.to} key={item.label} onClick={onClose}>
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </NavLink>
                ) : (
                  <div className="nav-item nav-item-disabled" key={item.label} title="Disponível em breve">
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-mini">
            <div className="avatar avatar-small">{user.name.charAt(0).toUpperCase()}</div>
            <div className="user-mini-copy"><strong>{user.name}</strong><span>{user.email}</span></div>
          </div>
          <button className="logout-button" type="button" onClick={onLogout}><LogOut size={17} /><span>Sair</span></button>
        </div>
      </aside>
    </>
  );
}
