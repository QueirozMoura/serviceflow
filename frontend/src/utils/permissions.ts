import type { User } from '../types/auth';

/**
 * As permissoes vem calculadas do servidor (GET /api/auth/me e login). Servem apenas para exibir ou ocultar acoes:
 * a barreira real de seguranca e a autorizacao do backend, que responde 403.
 */
export function hasPermission(user: Pick<User, 'permissions'> | null | undefined, permission: string): boolean {
  return user?.permissions?.includes(permission) ?? false;
}

/** Espelha serviceOrderStatusPermission do backend: permissão extra exigida para levar a OS ao status (null = só escrita). */
export function orderStatusPermission(status: string): string | null {
  if (status === 'APPROVED') return 'serviceOrders:approve';
  if (status === 'CANCELLED') return 'serviceOrders:cancel';
  return null;
}

/** Espelha quoteStatusPermission do backend: toda mudança de status do orçamento é decisão; expirar (e qualquer outro) exige quotes:expire. */
export function quoteStatusPermission(status: string): string {
  if (status === 'APPROVED') return 'quotes:approve';
  if (status === 'REJECTED') return 'quotes:reject';
  return 'quotes:expire';
}
