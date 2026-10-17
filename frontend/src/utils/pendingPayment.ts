import type { PaymentMethod } from '../types/payment';

// Operação de registro de pagamento cujo resultado ainda é desconhecido (falha de rede, timeout, resposta perdida).
// A Idempotency-Key precisa sobreviver a desmontagem do componente e a recarga da página, senão uma nova tentativa
// geraria outra chave e poderia duplicar um pagamento que o servidor já gravou.
//
// Persistência mínima: sessionStorage (só esta aba, some ao fechá-la), uma entrada por ordem de serviço, validade de
// 24h, contendo apenas chave, valor e método. Nada de sessão, token ou dados pessoais. A chave nunca vai para URL,
// log ou mensagem. Se o storage estiver indisponível, um espelho em memória cobre ao menos a navegação dentro da aba.

export interface PendingPayment { key: string; amount: string; method: PaymentMethod; createdAt: number }

/** O resultado do envio é desconhecido: a mesma tentativa deve ser repetida (mesma chave) ou descartada pelo usuário. */
export class PaymentOutcomeUnknownError extends Error {
  constructor() {
    super('Não foi possível confirmar se o pagamento foi registrado. Confira a lista e tente novamente com os mesmos dados: ele não será duplicado.');
    this.name = 'PaymentOutcomeUnknownError';
  }
}

const PREFIX = 'serviceflow:pending-payment:';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const mirror = new Map<string, PendingPayment>();

function isPending(value: unknown): value is PendingPayment {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.key === 'string' && candidate.key.length >= 8 && typeof candidate.amount === 'string' && typeof candidate.method === 'string' && typeof candidate.createdAt === 'number';
}

export function loadPendingPayment(serviceOrderId: string, now = Date.now()): PendingPayment | null {
  let found: PendingPayment | null = mirror.get(serviceOrderId) ?? null;
  if (!found) {
    try {
      const raw = window.sessionStorage.getItem(PREFIX + serviceOrderId);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (isPending(parsed)) found = parsed;
    } catch {
      // Storage indisponível ou conteúdo inválido: tratado como ausência.
    }
  }
  if (found && now - found.createdAt > MAX_AGE_MS) {
    clearPendingPayment(serviceOrderId);
    return null;
  }
  return found;
}

export function savePendingPayment(serviceOrderId: string, pending: PendingPayment): void {
  mirror.set(serviceOrderId, pending);
  try { window.sessionStorage.setItem(PREFIX + serviceOrderId, JSON.stringify(pending)); } catch { /* o espelho em memória permanece */ }
}

export function clearPendingPayment(serviceOrderId: string): void {
  mirror.delete(serviceOrderId);
  try { window.sessionStorage.removeItem(PREFIX + serviceOrderId); } catch { /* sem storage, nada a limpar */ }
}

/** Chamado no logout: nada de uma sessão deve restar para a próxima. */
export function clearAllPendingPayments(): void {
  mirror.clear();
  try {
    for (const name of Object.keys(window.sessionStorage)) if (name.startsWith(PREFIX)) window.sessionStorage.removeItem(name);
  } catch { /* sem storage, nada a limpar */ }
}

/** 4xx (exceto 408) significa que o servidor recusou sem criar o pagamento; qualquer outra falha deixa o resultado incerto. */
export function isDefinitiveRejection(status: number | undefined): boolean {
  return status !== undefined && status >= 400 && status < 500 && status !== 408;
}
