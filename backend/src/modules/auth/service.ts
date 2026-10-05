import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { createSessionToken, hashSessionToken, sessionExpiresAt } from './session.js';
import type { AuthRepository, AuthUserRecord, CreatedAccount } from './repository.js';
import type { LoginInput, RegisterInput } from './schemas.js';

export function makeOrganizationSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'organization';
}

export async function registerAccount(repository: AuthRepository, input: RegisterInput): Promise<CreatedAccount> {
  const passwordHash = await bcrypt.hash(input.password, 12);

  return repository.createOrganizationWithOwner({
    organizationName: input.organizationName,
    slug: makeOrganizationSlug(input.organizationName),
    name: input.name,
    email: input.email,
    passwordHash,
  });
}

export async function authenticateAccount(repository: AuthRepository, input: LoginInput): Promise<AuthUserRecord | null> {
  const users = await repository.findUsersByEmail(input.email);
  const matches = await Promise.all(
    users.map(async (user) => ({
      user,
      // Usuarios criados via Google nao possuem senha e nao podem autenticar por email/senha.
      matches: user.passwordHash !== null && (await bcrypt.compare(input.password, user.passwordHash)),
    })),
  );
  return matches.find((candidate) => candidate.matches)?.user ?? null;
}

export async function createUserSession(repository: AuthRepository, user: AuthUserRecord): Promise<string> {
  const { token, tokenHash } = createSessionToken();
  await repository.createSession({
    tokenHash,
    userId: user.id,
    organizationId: user.organizationId,
    expiresAt: sessionExpiresAt(),
  });
  return token;
}

export interface GoogleProfile {
  providerAccountId: string;
  email: string;
  name: string;
}

/**
 * Resolve o usuario para um perfil Google, sem criar senha artificial:
 * 1. Tenta pela identidade OAuth existente.
 * 2. Senao, vincula a um usuario com o mesmo email (login por senha continua valido).
 * 3. Senao, cria organizacao + usuario OWNER sem senha e vincula a identidade.
 */
export async function resolveGoogleUser(repository: AuthRepository, profile: GoogleProfile): Promise<AuthUserRecord> {
  const provider = 'google';
  const linked = await repository.findUserByOAuthAccount(provider, profile.providerAccountId);
  if (linked) return linked;

  const existing = (await repository.findUsersByEmail(profile.email))[0];
  if (existing) {
    await repository.linkOAuthAccount({
      provider,
      providerAccountId: profile.providerAccountId,
      userId: existing.id,
      organizationId: existing.organizationId,
    });
    return existing;
  }

  const { user } = await repository.createOrganizationWithOAuthUser({
    organizationName: `${profile.name} (Google)`,
    slug: makeOrganizationSlug(`${profile.name} ${profile.providerAccountId}`),
    name: profile.name,
    email: profile.email,
    provider,
    providerAccountId: profile.providerAccountId,
  });
  return user;
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') ||
    (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002');
}

export function getPublicUser(user: AuthUserRecord) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
  };
}

export function getPublicAccount(account: CreatedAccount) {
  return {
    user: getPublicUser(account.user),
    organization: account.organization,
  };
}

export function getSessionTokenHash(token: string): string {
  return hashSessionToken(token);
}

export { env };