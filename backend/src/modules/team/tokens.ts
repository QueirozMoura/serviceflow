import { createHash, randomBytes } from 'node:crypto';

/** 7 dias. Depois disso o convite deixa de valer (o OWNER cria outro). */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Token de convite: 256 bits aleatorios. So o hash (sha256) e gravado; o token aparece uma unica vez, na criacao. */
export function createInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
