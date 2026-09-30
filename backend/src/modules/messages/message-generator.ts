import { Prisma, QuoteStatus, ServiceItemType, WarrantyStatus } from '@prisma/client';
import type { MessageContext } from './repository.js';
import type { MessageType } from './schemas.js';

export class MessageDataUnavailableError extends Error {}

export type GeneratedMessage = {
  type: MessageType;
  serviceOrderId: string;
  customer: { name: string };
  phone: string;
  message: string;
};

function equipmentName(context: MessageContext): string {
  return [context.equipment.type, context.equipment.brand, context.equipment.model].filter(Boolean).join(' ');
}

function money(value: Prisma.Decimal): string {
  return `R$ ${value.toFixed(2).replace('.', ',')}`;
}

function date(value: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: 'UTC' }).format(value);
}

function unavailable(message: string): never {
  throw new MessageDataUnavailableError(message);
}

export function generateMessage(type: MessageType, context: MessageContext): GeneratedMessage {
  const customerName = context.customer.name;
  const equipment = equipmentName(context);
  let message: string;

  switch (type) {
    case 'SERVICE_RECEIVED':
      message = `Olá, ${customerName}! Recebemos seu ${equipment} para avaliação. Sua ordem de serviço é ${context.orderNumber}.`;
      break;
    case 'DIAGNOSIS_READY':
      if (!context.diagnosis) unavailable('Diagnosis is required for this message');
      message = `Olá, ${customerName}! O diagnóstico da ordem ${context.orderNumber}, referente ao seu ${equipment}, está pronto: ${context.diagnosis.description}`;
      break;
    case 'QUOTE_READY':
      if (!context.quote) unavailable('Quote is required for this message');
      message = `Olá, ${customerName}! O orçamento da ordem ${context.orderNumber}, referente ao seu ${equipment}, está pronto.\n`;
      if (context.quote.items.length > 0) {
        message += `${context.quote.items.map((item) => `${item.type === ServiceItemType.LABOR ? 'Serviço' : 'Peça'}: ${item.description} — ${money(item.quantity.mul(item.unitPrice))}`).join('\n')}\n`;
      }
      message += `Total: ${money(context.quote.total)}`;
      break;
    case 'QUOTE_APPROVED':
      if (!context.quote || context.quote.status !== QuoteStatus.APPROVED) unavailable('An approved quote is required for this message');
      message = `Olá, ${customerName}! O orçamento da ordem ${context.orderNumber}, referente ao seu ${equipment}, foi aprovado e o serviço poderá prosseguir.`;
      break;
    case 'SERVICE_IN_PROGRESS':
      message = `Olá, ${customerName}! O serviço da ordem ${context.orderNumber}, referente ao seu ${equipment}, está em andamento.`;
      break;
    case 'SERVICE_READY':
      message = `Olá, ${customerName}! Seu ${equipment} está pronto para retirada. Ordem de serviço: ${context.orderNumber}.`;
      break;
    case 'SERVICE_DELIVERED':
      message = `Olá, ${customerName}! Confirmamos a entrega do seu ${equipment}, referente à ordem ${context.orderNumber}.`;
      break;
    case 'WARRANTY_CREATED':
      if (!context.warranty) unavailable('Warranty is required for this message');
      if (context.warranty.status === WarrantyStatus.CANCELLED) unavailable('An active warranty is required for this message');
      message = `Olá, ${customerName}! Foi registrada a garantia do serviço da ordem ${context.orderNumber}, referente ao seu ${equipment}, de ${date(context.warranty.startDate)} a ${date(context.warranty.endDate)}.`;
      if (context.warranty.description) message += ` ${context.warranty.description}`;
      break;
  }

  return { type, serviceOrderId: context.id, customer: { name: customerName }, phone: context.customer.phone, message };
}