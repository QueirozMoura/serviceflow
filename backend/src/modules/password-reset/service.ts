import bcrypt from 'bcryptjs';
import type { Mailer } from '../mail/mailer.js';
import { buildPasswordResetEmail } from '../mail/templates.js';
import type { PasswordResetRepository } from './repository.js';
import { PASSWORD_RESET_COOLDOWN_MS, PASSWORD_RESET_TTL_MS, createResetToken, hashResetToken } from './tokens.js';

/** So mensagens fixas: nunca e-mail, token, link ou senha. */
export interface RecoveryLogger {
  warn(message: string): void;
  error(message: string): void;
}

export type ResetOutcome = 'ok' | 'invalid' | 'reuse';

export class PasswordRecoveryService {
  private readonly tasks = new Set<Promise<void>>();

  constructor(private readonly deps: { repository: PasswordResetRepository; mailer: Mailer; appBaseUrl: string; clock?: () => Date }) {}

  private now(): Date { return this.deps.clock ? this.deps.clock() : new Date(); }

  /**
   * Dispara a recuperacao SEM aguardar: a resposta HTTP e identica e imediata exista a conta ou nao (nada de consulta ao
   * banco, escrita ou chamada ao provedor entra no tempo de resposta). Erros ficam registrados sem dados sensiveis.
   */
  start(email: string, log: RecoveryLogger): void {
    const task: Promise<void> = this.process(email, log)
      .catch(() => log.error('Password recovery request failed'))
      .finally(() => { this.tasks.delete(task); });
    this.tasks.add(task);
  }

  /** Aguarda as solicitacoes em andamento (encerramento do servidor e testes). */
  async idle(): Promise<void> { while (this.tasks.size > 0) await Promise.allSettled([...this.tasks]); }

  private async process(email: string, log: RecoveryLogger): Promise<void> {
    // Sem provedor de e-mail nao se cria token algum: ninguem poderia receber o link.
    if (!this.deps.mailer.enabled) { log.warn('Password recovery was requested but no mail provider is configured'); return; }
    const accounts = await this.deps.repository.findLocalAccounts(email);
    for (const account of accounts) {
      const { token, tokenHash } = createResetToken();
      const now = this.now();
      const issued = await this.deps.repository.issueToken({ userId: account.id, organizationId: account.organizationId, tokenHash, expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS), now, cooldownMs: PASSWORD_RESET_COOLDOWN_MS });
      if (!issued) continue;
      const link = `${this.deps.appBaseUrl.replace(/\/$/, '')}/reset-password#t=${token}`;
      try {
        await this.deps.mailer.send(buildPasswordResetEmail({ to: email, name: account.name, organizationName: account.organizationName, link, validForMinutes: PASSWORD_RESET_TTL_MS / 60_000 }));
      } catch {
        // Nao entregue: o token nao pode ficar utilizavel.
        await this.deps.repository.discardToken(tokenHash);
        log.error('Password recovery e-mail could not be delivered');
      }
    }
  }

  async validate(token: string): Promise<boolean> {
    return (await this.deps.repository.previewToken(hashResetToken(token), this.now())) !== null;
  }

  async reset(token: string, password: string): Promise<ResetOutcome> {
    const tokenHash = hashResetToken(token);
    const preview = await this.deps.repository.previewToken(tokenHash, this.now());
    if (!preview) return 'invalid';
    // Outra conta com o mesmo e-mail em outra equipe: o login as distingue pela senha, entao nao pode repeti-la.
    for (const hash of preview.otherPasswordHashes) if (await bcrypt.compare(password, hash)) return 'reuse';
    return this.deps.repository.consumeToken({ tokenHash, passwordHash: await bcrypt.hash(password, 12), now: this.now() });
  }
}
