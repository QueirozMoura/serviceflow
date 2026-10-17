import { clearAllPendingPayments } from '../utils/pendingPayment';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../services/api';
import type { AuthResponse, User } from '../types/auth';
import { hasActiveSession } from '../utils/sessionProbe';
import { hasPermission } from '../utils/permissions';

interface LoginInput {
  email: string;
  password: string;
}

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  updateProfile: (input: { name: string }) => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refreshSession = async () => {
    try {
      const response = await api.get<AuthResponse>('/api/auth/me');
      setUser(response.user);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (location.pathname === '/') {
      setIsLoading(false);
      void (async () => {
        if (await hasActiveSession()) await refreshSession();
      })();
      return;
    }

    void refreshSession();
    const handleUnauthorized = () => setUser(null);
    window.addEventListener('serviceflow:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('serviceflow:unauthorized', handleUnauthorized);
  }, [location.pathname]);

  const login = async (input: LoginInput) => {
    const response = await api.post<AuthResponse>('/api/auth/login', input);
    setUser(response.user);
  };

  const logout = async () => {
    try {
      await api.post<void>('/api/auth/logout');
    } finally {
      clearAllPendingPayments();
      setUser(null);
    }
  };

  // O backend identifica o usuário pela sessão; a resposta atualiza o contexto (Sidebar/Header) sem novo login.
  const updateProfile = async (input: { name: string }) => {
    const response = await api.patch<AuthResponse>('/api/auth/me', input);
    setUser(response.user);
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: user !== null, isLoading, login, logout, refreshSession, updateProfile, can: (permission) => hasPermission(user, permission) }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
}
