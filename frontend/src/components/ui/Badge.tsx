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

export function Badge({ value }: { value: string }) {
  return <span className={`badge badge-${value.toLowerCase()}`}>{statusLabels[value] ?? value}</span>;
}
