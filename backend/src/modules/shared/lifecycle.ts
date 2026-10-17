import { ServiceOrderStatus } from '@prisma/client';

// Regras do ciclo de vida da OS compartilhadas por todos os caminhos de escrita. Tudo aqui e avaliado DENTRO da
// transacao, com a linha da OS travada (ver due-value.ts), nunca a partir de uma leitura anterior da rota.

/** Erro de regra de negocio: a requisicao e valida, mas conflita com o estado atual. Vira HTTP 409. */
export class DomainConflictError extends Error {}

/** O usuario nao tem permissao para a parte financeira da alteracao. Vira HTTP 403. */
export class FinancialChangeForbiddenError extends Error {
  constructor() {
    super('You do not have permission to change financial values');
    this.name = 'FinancialChangeForbiddenError';
  }
}

export class ServiceOrderLockedError extends DomainConflictError {
  constructor() {
    super('Service order is delivered or cancelled and can no longer be changed');
    this.name = 'ServiceOrderLockedError';
  }
}
export class InvalidStatusTransitionError extends DomainConflictError {
  constructor() {
    super('Invalid service order status transition');
    this.name = 'InvalidStatusTransitionError';
  }
}
export class QuoteNotApprovedError extends DomainConflictError {
  constructor() {
    super('Service order approval requires an approved quote');
    this.name = 'QuoteNotApprovedError';
  }
}
export class OpenBalanceError extends DomainConflictError {
  constructor() {
    super('Service order cannot be delivered while there is an open balance or pending payments');
    this.name = 'OpenBalanceError';
  }
}
export class PaidPaymentsError extends DomainConflictError {
  constructor() {
    super('Service order has confirmed payments: refund them before cancelling');
    this.name = 'PaidPaymentsError';
  }
}

/** Unica fonte das transicoes validas de status da OS. DELIVERED e CANCELLED sao terminais. */
export const SERVICE_ORDER_TRANSITIONS: Record<ServiceOrderStatus, ServiceOrderStatus[]> = {
  RECEIVED: [ServiceOrderStatus.WAITING_DIAGNOSIS, ServiceOrderStatus.CANCELLED],
  WAITING_DIAGNOSIS: [ServiceOrderStatus.WAITING_APPROVAL, ServiceOrderStatus.CANCELLED],
  WAITING_APPROVAL: [ServiceOrderStatus.APPROVED, ServiceOrderStatus.CANCELLED],
  APPROVED: [ServiceOrderStatus.IN_PROGRESS, ServiceOrderStatus.CANCELLED],
  IN_PROGRESS: [ServiceOrderStatus.READY, ServiceOrderStatus.CANCELLED],
  READY: [ServiceOrderStatus.DELIVERED, ServiceOrderStatus.CANCELLED],
  DELIVERED: [],
  CANCELLED: [],
};

export function isTerminalStatus(status: ServiceOrderStatus): boolean {
  return status === ServiceOrderStatus.DELIVERED || status === ServiceOrderStatus.CANCELLED;
}

/** Bloqueia qualquer alteracao operacional ou financeira de uma OS entregue ou cancelada. */
export function assertServiceOrderEditable(status: ServiceOrderStatus): void {
  if (isTerminalStatus(status)) throw new ServiceOrderLockedError();
}
