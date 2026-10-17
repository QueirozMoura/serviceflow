import { randomBytes } from 'node:crypto';
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

/** O e-mail ja tem conta: o cadastro publico e recusado com a mesma resposta generica de qualquer outra falha de criacao. */
export class AccountAlreadyExistsError extends Error {
  constructor() {
    super('Unable to create account');
    this.name = 'AccountAlreadyExistsError';
  }
}

const SLUG_ATTEMPTS = 5;

/**
 * Slug = nome normalizado + sufixo aleatorio de 32 bits. O nome nunca precisa ser unico (duas empresas podem se chamar
 * igual); a unicidade e garantida pelo indice unico do PostgreSQL: numa colisao (rara, ou concorrente) a criacao
 * transacional inteira e refeita com outro sufixo, no maximo SLUG_ATTEMPTS vezes. O slug e so um identificador publico:
 * isolamento e autorizacao usam sempre organizationId.
 */
export function makeUniqueOrganizationSlug(name: string): string {
  return `${makeOrganizationSlug(name)}-${randomBytes(4).toString('hex')}`;
}

export async function registerAccount(repository: AuthRepository, input: RegisterInput): Promise<CreatedAccount> {
  // Uma conta COM SENHA por e-mail no cadastro publico: duas contas de senha com o mesmo e-mail tornariam o login ambiguo.
  // Contas Google (sem senha) nao entram na checagem: nao fazem login por senha e a identidade Google nunca e vinculada
  // por e-mail (ver resolveGoogleUser), entao esse cadastro nao toma nem altera a conta Google existente.
  if ((await repository.findUsersByEmail(input.email)).some((user) => user.passwordHash !== null)) throw new AccountAlreadyExistsError();
  const passwordHash = await bcrypt.hash(input.password, 12);

  for (let attempt = 1; ; attempt += 1) {
    try {
      // Organizacao e OWNER nascem na mesma transacao do repositorio: falhou, nada fica gravado.
      return await repository.createOrganizationWithOwner({
        organizationName: input.organizationName,
        slug: makeUniqueOrganizationSlug(input.organizationName),
        name: input.name,
        email: input.email,
        passwordHash,
      });
    } catch (error) {
      if (!isUniqueConstraintError(error) || attempt >= SLUG_ATTEMPTS) throw error;
    }
  }
}

// Hash bcrypt (custo 12) de um valor aleatorio descartado. Serve so para gastar o mesmo tempo de uma verificacao real
// quando nao ha senha a verificar (e-mail inexistente ou conta so Google); nao corresponde a nenhuma senha de usuario.
const TIMING_DUMMY_HASH = '$2b$12$4sUFwUwMG0qWV6gHWU/crOXhJfKEAydzZGDvzX4feY51yxY8Mc5Za';

export async function authenticateAccount(repository: AuthRepository, input: LoginInput): Promise<AuthUserRecord | null> {
  const users = await repository.findUsersByEmail(input.email);
  // Sempre ha ao menos uma comparacao bcrypt e uma por conta, tenha a conta senha ou nao: o tempo de resposta nao
  // distingue e-mail inexistente, conta so Google e conta com senha errada.
  const candidates: Array<AuthUserRecord | null> = users.length > 0 ? users : [null];
  const matches = await Promise.all(
    candidates.map(async (user) => {
      const hash = user?.passwordHash ?? TIMING_DUMMY_HASH;
      const valid = await bcrypt.compare(input.password, hash);
      // Usuarios criados via Google nao possuem senha e nao podem autenticar por email/senha.
      return { user, matches: valid && user !== null && user.passwordHash !== null };
    }),
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