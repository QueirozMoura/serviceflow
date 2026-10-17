import { createHash, randomBytes } from 'node:crypto';

/** Validade curta: 30 minutos. */
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
/** Uma conta recebe no maximo um e-mail de recuperacao por minuto (evita usar o sistema para inundar uma caixa de e-mail). */
export const PASSWORD_RESET_COOLDOWN_MS = 60 * 1000;
/** Contas com o mesmo e-mail em equipes diferentes: limite de mensagens por solicitacao. */
export const MAX_ACCOUNTS_PER_REQUEST = 5;

export function createResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashResetToken(token) };
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
