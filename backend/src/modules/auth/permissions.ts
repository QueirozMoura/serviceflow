import { QuoteStatus, ServiceOrderStatus, UserRole } from '@prisma/client';

// Fonte unica da autorizacao por papel. Formato: <recurso>:<acao>.
//   write  = criar e editar (inclui mudar status e itens de orcamento)
//   delete = excluir o registro
//   approve / cancel / reject / expire / status = decisoes sobre o status, exigidas alem de write
export const PERMISSIONS = [
  'customers:read', 'customers:write', 'customers:delete',
  'equipment:read', 'equipment:write', 'equipment:delete',
  'serviceOrders:read', 'serviceOrders:write', 'serviceOrders:approve', 'serviceOrders:cancel', 'serviceOrders:delete',
  'diagnoses:read', 'diagnoses:write', 'diagnoses:delete',
  'quotes:read', 'quotes:write', 'quotes:approve', 'quotes:reject', 'quotes:expire', 'quotes:delete',
  'payments:read', 'payments:write', 'payments:delete',
  'warranties:read', 'warranties:write', 'warranties:status', 'warranties:delete',
  'messages:generate',
  'dashboard:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

// OWNER e ADMIN: hoje nenhuma operacao e exclusiva do dono (nao ha gestao de usuarios nem de dados da organizacao).
// TECHNICIAN: lista explicita (negado por padrao). Novas permissoes nao chegam ao tecnico sem serem adicionadas aqui.
// Regras de negocio do TECHNICIAN: NAO aprova nem cancela OS (serviceOrders:approve / :cancel, em nenhum estado),
// NAO aprova, rejeita nem expira orcamento (quotes:approve / :reject / :expire), NAO altera o status de garantia
// (warranties:status) e NAO acessa pagamentos. Ele PODE avancar e entregar a OS (as demais transicoes, validadas
// pela rota), consultar/editar orcamentos e itens, e criar/editar garantias.
const technicianPermissions: readonly Permission[] = [
  'customers:read', 'customers:write',
  'equipment:read', 'equipment:write',
  'serviceOrders:read', 'serviceOrders:write',
  'diagnoses:read', 'diagnoses:write',
  'quotes:read', 'quotes:write',
  'warranties:read', 'warranties:write',
  'messages:generate',
  'dashboard:read',
];

const rolePermissions: Record<UserRole, ReadonlySet<Permission>> = {
  [UserRole.OWNER]: new Set(PERMISSIONS),
  [UserRole.ADMIN]: new Set(PERMISSIONS),
  [UserRole.TECHNICIAN]: new Set(technicianPermissions),
};

/** Permissao extra exigida para levar a OS ao status informado (null = so serviceOrders:write). */
export function serviceOrderStatusPermission(status: ServiceOrderStatus): Permission | null {
  if (status === ServiceOrderStatus.APPROVED) return 'serviceOrders:approve';
  if (status === ServiceOrderStatus.CANCELLED) return 'serviceOrders:cancel';
  return null;
}

/**
 * Toda mudanca de status do orcamento e decisao comercial: aprovar e rejeitar tem permissao propria e
 * qualquer outro valor (EXPIRED e os demais) exige quotes:expire, entao nenhum status escapa da verificacao.
 */
export function quoteStatusPermission(status: QuoteStatus): Permission {
  if (status === QuoteStatus.APPROVED) return 'quotes:approve';
  if (status === QuoteStatus.REJECTED) return 'quotes:reject';
  return 'quotes:expire';
}

export function permissionsFor(role: UserRole): Permission[] {
  // Papel desconhecido (ex.: valor novo no banco sem regra aqui) nao recebe nenhuma permissao.
  return PERMISSIONS.filter((permission) => rolePermissions[role]?.has(permission) ?? false);
}

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return rolePermissions[role]?.has(permission) ?? false;
}
