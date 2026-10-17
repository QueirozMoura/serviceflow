const statusLabels: Record<string, string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovado',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
  OPEN: 'Aberta',
  RECEIVED: 'Recebida',
  WAITING_DIAGNOSIS: 'Aguardando diagnóstico',
  WAITING_APPROVAL: 'Aguardando aprovação',
  READY: 'Pronta',
  DELIVERED: 'Entregue',
  PAID: 'Pago',
  FAILED: 'Falhou',
  REFUNDED: 'Reembolsado',
  REJECTED: 'Rejeitado',
  EXPIRED: 'Expirado',
  ACTIVE: 'Ativa',
};

export const statusLabel = (value: string) => statusLabels[value] ?? value;

export function Badge({ value }: { value: string }) {
  return <span className={`badge badge-${value.toLowerCase()}`}>{statusLabel(value)}</span>;
}
