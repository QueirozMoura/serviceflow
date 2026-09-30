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

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(env.AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    maxAge: env.AUTH_SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(env.AUTH_COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: env.NODE_ENV === 'production', path: '/' });
}