import { api } from '../services/api';

interface SessionStatusResponse {
  authenticated: boolean;
}

export async function hasActiveSession(): Promise<boolean> {
  try {
    const response = await api.get<SessionStatusResponse>('/api/auth/session');
    return response.authenticated === true;
  } catch {
    return false;
  }
}