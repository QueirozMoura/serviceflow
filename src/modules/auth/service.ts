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
  const matches = await Promise.all(users.map(async (user) => ({ user, matches: await bcrypt.compare(input.password, user.passwordHash) })));
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