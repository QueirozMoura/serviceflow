import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

export function AppLayout() {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();

  if (!user) return null;

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell"><a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
      <Sidebar user={user} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} onLogout={() => void handleLogout()} />
      <div className="app-main"><Header user={user} onMenuClick={() => setSidebarOpen(true)} onLogout={() => void handleLogout()} /><main className="page-content" id="conteudo" tabIndex={-1}><Outlet /></main></div>
    </div>
  );
}
