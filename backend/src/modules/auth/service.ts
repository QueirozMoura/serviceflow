import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { createSessionToken, hashSessionToken, sessionExpiresAt } from './session.js';
import type { AuthRepository, AuthUserRecord, CreatedAccount } from './repository.js';
import type { LoginInput, RegisterInput } from './schemas.js';
import { permissionsFor } from './permissions.js';

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
 * Existe uma conta local com o e-mail do Google, mas sem vinculo com esta identidade. Nao e seguro vincular so porque
 * os e-mails coincidem: o cadastro por senha nao comprova que quem criou a conta controla o e-mail, entao a vitima
 * entraria na conta (e na organizacao) do atacante, que seguiria com a senha. O acesso e recusado sem alterar nada.
 */
export class GoogleAccountNotLinkedError extends Error {
  constructor() {
    super('Google identity is not linked to the existing account');
    this.name = 'GoogleAccountNotLinkedError';
  }
}

/**
 * Resolve o usuario para um perfil Google, sem criar senha artificial:
 * 1. Identidade OAuth ja vinculada: entra na conta vinculada.
 * 2. Existe conta local com o mesmo e-mail (com ou sem outra identidade): RECUSA, sem vincular nem escrever nada.
 *    Vincular exigiria provar a posse da conta local (sessao autenticada + fluxo explicito), que nao existe ainda.
 * 3. Nenhuma conta com o e-mail: cria organizacao + usuario OWNER sem senha e vincula a identidade.
 */
export async function resolveGoogleUser(repository: AuthRepository, profile: GoogleProfile): Promise<AuthUserRecord> {
  const provider = 'google';
  const linked = await repository.findUserByOAuthAccount(provider, profile.providerAccountId);
  if (linked) return linked;

  const existing = await repository.findUsersByEmail(profile.email);
  if (existing.length > 0) throw new GoogleAccountNotLinkedError();

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
    // Permissoes efetivas calculadas no servidor; o frontend as usa so para exibir/ocultar acoes.
    permissions: permissionsFor(user.role),
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