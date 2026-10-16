import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import type { AuthRepository, AuthUserRecord } from '../src/modules/auth/repository.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

const { GoogleAccountNotLinkedError, resolveGoogleUser } = await import('../src/modules/auth/service.js');

const organization = { id: 'organization-1', name: 'Oficina', slug: 'oficina' };
const local: AuthUserRecord = { id: 'user-1', organizationId: organization.id, name: 'Dono', email: 'dono@example.com', passwordHash: 'hash', role: UserRole.OWNER, organization };
const profile = { providerAccountId: 'google-sub', email: 'dono@example.com', name: 'Dono' };

// Repositorio que registra tudo o que e chamado, para provar que uma recusa nao escreve nada.
function repositoryWith(options: { linked?: AuthUserRecord | null; byEmail?: AuthUserRecord[] }) {
  const calls: string[] = [];
  const track = <T>(name: string, value: T) => vi.fn(async () => { calls.push(name); return value; });
  const repository = {
    findUserByOAuthAccount: track('findUserByOAuthAccount', options.linked ?? null),
    findUsersByEmail: track('findUsersByEmail', options.byEmail ?? []),
    linkOAuthAccount: track('linkOAuthAccount', undefined),
    createOrganizationWithOAuthUser: vi.fn(async () => { calls.push('createOrganizationWithOAuthUser'); return { user: { ...local, id: 'new-user', passwordHash: null }, organization }; }),
  } as unknown as AuthRepository;
  return { repository, calls };
}

describe('resolveGoogleUser', () => {
  it('returns the account an identity is already linked to without looking at the e-mail', async () => {
    const { repository, calls } = repositoryWith({ linked: local, byEmail: [] });
    expect(await resolveGoogleUser(repository, { ...profile, email: 'different@example.com' })).toBe(local);
    expect(calls).toEqual(['findUserByOAuthAccount']);
  });

  it('refuses when a local account has the same e-mail, without linking or creating anything', async () => {
    const { repository, calls } = repositoryWith({ byEmail: [local] });
    await expect(resolveGoogleUser(repository, profile)).rejects.toBeInstanceOf(GoogleAccountNotLinkedError);
    expect(calls).toEqual(['findUserByOAuthAccount', 'findUsersByEmail']);
  });

  it('refuses even when several accounts use the e-mail', async () => {
    const other = { ...local, id: 'user-2', organizationId: 'organization-2', organization: { ...organization, id: 'organization-2', slug: 'outra' } };
    const { repository, calls } = repositoryWith({ byEmail: [local, other] });
    await expect(resolveGoogleUser(repository, profile)).rejects.toBeInstanceOf(GoogleAccountNotLinkedError);
    expect(calls).not.toContain('linkOAuthAccount');
    expect(calls).not.toContain('createOrganizationWithOAuthUser');
  });

  it('creates a new organization and owner only when no account uses the e-mail', async () => {
    const { repository, calls } = repositoryWith({ byEmail: [] });
    const user = await resolveGoogleUser(repository, profile);
    expect(user.id).toBe('new-user');
    expect(calls).toEqual(['findUserByOAuthAccount', 'findUsersByEmail', 'createOrganizationWithOAuthUser']);
    expect(repository.createOrganizationWithOAuthUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'dono@example.com', provider: 'google', providerAccountId: 'google-sub' }));
  });

  it('uses an error that does not carry the e-mail or any account data', async () => {
    const { repository } = repositoryWith({ byEmail: [local] });
    const error = (await resolveGoogleUser(repository, profile).then(() => null, (cause: unknown) => cause)) as Error;
    expect(error.message).not.toContain('dono@example.com');
    expect(error.message).not.toContain(organization.name);
    expect(error.name).toBe('GoogleAccountNotLinkedError');
  });
});
