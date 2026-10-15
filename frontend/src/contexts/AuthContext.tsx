import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../services/api';
import type { AuthResponse, User } from '../types/auth';
import { hasActiveSession } from '../utils/sessionProbe';

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
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: user !== null, isLoading, login, logout, refreshSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
}
