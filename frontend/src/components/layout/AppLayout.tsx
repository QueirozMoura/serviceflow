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
    <div className="app-shell">
      <Sidebar user={user} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} onLogout={() => void handleLogout()} />
      <div className="app-main"><Header user={user} onMenuClick={() => setSidebarOpen(true)} /><main className="page-content"><Outlet /></main></div>
    </div>
  );
}
