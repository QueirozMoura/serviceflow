import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import { env } from '../../config/env.js';

export function createSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionExpiresAt(): Date {
  return new Date(Date.now() + env.AUTH_SESSION_TTL_SECONDS * 1000);
}

function cookieSecurityOptions() {
  // SameSite=None so funciona com Secure; producao sempre usa HTTPS.
  const secure = env.NODE_ENV === 'production' || env.AUTH_COOKIE_SAME_SITE === 'none';
  return { httpOnly: true, sameSite: env.AUTH_COOKIE_SAME_SITE, secure, path: '/' } as const;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(env.AUTH_COOKIE_NAME, token, {
    ...cookieSecurityOptions(),
    maxAge: env.AUTH_SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(env.AUTH_COOKIE_NAME, cookieSecurityOptions());
}

const OAUTH_STATE_COOKIE = 'serviceflow_oauth_state';

/** Guarda o state anti-CSRF do OAuth em cookie HttpOnly de curta duracao. */
export function setOAuthStateCookie(reply: FastifyReply, state: string): void {
  reply.setCookie(OAUTH_STATE_COOKIE, state, {
    ...cookieSecurityOptions(),
    maxAge: 600,
  });
}

export function readOAuthStateCookie(cookies: Record<string, string | undefined>): string | undefined {
  return cookies[OAUTH_STATE_COOKIE];
}

export function clearOAuthStateCookie(reply: FastifyReply): void {
  reply.clearCookie(OAUTH_STATE_COOKIE, cookieSecurityOptions());
}