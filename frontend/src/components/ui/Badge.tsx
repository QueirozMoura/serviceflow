const statusLabels: Record<string, string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovado',
  IN_PROGRESS: 'Em andamento',
  COMPLETED: 'Concluída',
  CANCELLED: 'Cancelada',
  OPEN: 'Aberta',
};

export function Badge({ value }: { value: string }) {
  return <span className={`badge badge-${value.toLowerCase()}`}>{statusLabels[value] ?? value}</span>;
}
