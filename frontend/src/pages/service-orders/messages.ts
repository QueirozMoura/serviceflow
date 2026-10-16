import { ApiError } from '../../services/api';

/** Traduz falhas de DELETE /api/service-orders/:id sem tentar contornar as restrições do servidor. */
export function serviceOrderDeleteErrorMessage(cause: unknown): string {
  if (!(cause instanceof ApiError)) return 'Não foi possível excluir a ordem de serviço. Verifique sua conexão e tente novamente.';
  if (cause.status === 403) return 'Você não tem permissão para excluir ordens de serviço.';
  if (cause.status === 409) return 'Esta OS possui histórico ou registros vinculados e não pode ser excluída. Para encerrar o atendimento, altere o status para Cancelada.';
  if (cause.status === 404) return 'Esta ordem de serviço não foi encontrada. Ela pode já ter sido excluída.';
  if (cause.status === 401) return 'Sua sessão expirou. Entre novamente.';
  return 'Não foi possível excluir a ordem de serviço.';
}

export function diagnosisErrorMessage(cause: unknown): string {
  if (!(cause instanceof ApiError)) return 'Não foi possível salvar o diagnóstico. Verifique sua conexão e tente novamente.';
  if (cause.status === 403) return 'Você não tem permissão para alterar o diagnóstico.';
  if (cause.status === 400) return 'Revise os dados do diagnóstico.';
  if (cause.status === 409) return 'Esta OS já possui um diagnóstico registrado. Revise os dados e salve novamente para atualizá-lo.';
  if (cause.status === 404) return 'O diagnóstico não existe mais. Salve novamente para registrar um novo.';
  if (cause.status === 401) return 'Sua sessão expirou. Entre novamente.';
  return 'Não foi possível salvar o diagnóstico.';
}

const decimalPattern = /^\d+(\.\d{1,2})?$/;

/** Espelha createDiagnosisSchema do backend: descrição 2–4000 caracteres e custo opcional com até 2 casas. */
export function validateDiagnosis(description: string, estimatedCost: string | null): string | null {
  if (description.length < 2) return 'Descreva o diagnóstico com pelo menos 2 caracteres.';
  if (description.length > 4000) return 'O diagnóstico deve ter no máximo 4000 caracteres.';
  if (estimatedCost !== null && !decimalPattern.test(estimatedCost)) return 'Informe um custo estimado válido, por exemplo 150,00.';
  return null;
}
