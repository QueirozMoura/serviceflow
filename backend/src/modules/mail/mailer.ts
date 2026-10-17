export interface MailMessage { to: string; subject: string; text: string; html: string }

/** O provedor recusou ou nao respondeu. A mensagem nunca carrega destinatario, corpo, token nem credencial. */
export class MailDeliveryError extends Error {
  constructor(message = 'Mail could not be delivered') {
    super(message);
    this.name = 'MailDeliveryError';
  }
}

export interface Mailer {
  /** false = nenhum provedor configurado: nada sera enviado e fluxos que dependem de e-mail ficam inoperantes. */
  readonly enabled: boolean;
  send(message: MailMessage): Promise<void>;
}

export class DisabledMailer implements Mailer {
  readonly enabled = false;
  send(): Promise<void> { return Promise.reject(new MailDeliveryError('Mail provider is not configured')); }
}

/** Desenvolvimento: guarda as mensagens em memoria (nada sai da maquina). Proibido em producao pela validacao do ambiente. */
export class OutboxMailer implements Mailer {
  readonly enabled = true;
  readonly messages: MailMessage[] = [];
  send(message: MailMessage): Promise<void> { this.messages.push(message); return Promise.resolve(); }
}

/** Resend (https://resend.com): um POST autenticado por chave de API. Usa o fetch nativo; nenhuma dependencia nova. */
export class ResendMailer implements Mailer {
  readonly enabled = true;
  constructor(private readonly apiKey: string, private readonly from: string, private readonly timeoutMs = 10_000, private readonly fetchImpl: typeof fetch = fetch) {}

  async send(message: MailMessage): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new MailDeliveryError('Mail provider is unreachable');
    }
    // So o status vai para o erro: o corpo da resposta pode repetir o destinatario ou o conteudo.
    if (!response.ok) throw new MailDeliveryError(`Mail provider responded with status ${response.status}`);
  }
}

export function createMailer(config: { MAIL_PROVIDER?: 'resend' | 'outbox' | undefined; RESEND_API_KEY?: string | undefined; MAIL_FROM?: string | undefined }): Mailer {
  if (config.MAIL_PROVIDER === 'resend' && config.RESEND_API_KEY && config.MAIL_FROM) return new ResendMailer(config.RESEND_API_KEY, config.MAIL_FROM);
  if (config.MAIL_PROVIDER === 'outbox') return new OutboxMailer();
  return new DisabledMailer();
}
