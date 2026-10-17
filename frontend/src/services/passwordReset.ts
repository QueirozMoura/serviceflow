import { api } from './api';

export const passwordResetService = {
  /** Resposta sempre genérica (202): não informa se o e-mail tem conta. */
  request: (email: string) => api.post<{ message: string }>('/api/auth/password/forgot', { email }),
  /** O token vai no corpo (POST), nunca na URL da API, para não aparecer em logs de requisição. */
  validate: (token: string) => api.post<{ valid: true }>('/api/auth/password/validate', { token }),
  reset: (token: string, password: string) => api.post<{ message: string }>('/api/auth/password/reset', { token, password }),
};

/** O token do e-mail fica no fragmento (#t=...), que o navegador nunca envia a nenhum servidor. */
export function resetTokenFromHash(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, '')).get('t');
}
