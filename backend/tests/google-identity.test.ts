import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

const jwtVerify = vi.hoisted(() => vi.fn());
vi.mock('jose', () => ({ createRemoteJWKSet: vi.fn(() => 'jwks'), jwtVerify }));

const { exchangeCodeForIdentity, GoogleOAuthError } = await import('../src/modules/auth/google.js');

const config = { clientId: 'client-id.apps.googleusercontent.com', clientSecret: 'client-secret', redirectUri: 'https://api.example.com/api/auth/google/callback' };
const claims = { sub: 'google-sub-1', email: 'Person@Example.COM', email_verified: true, name: 'Person Name' };

describe('exchangeCodeForIdentity', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id_token: 'signed.id.token' }) });
    jwtVerify.mockResolvedValue({ payload: claims });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns the verified identity with a lower-cased e-mail', async () => {
    const identity = await exchangeCodeForIdentity(config, 'auth-code');
    expect(identity).toEqual({ providerAccountId: 'google-sub-1', email: 'person@example.com', name: 'Person Name' });
  });

  it('verifies the signature, issuer and audience of the id_token', async () => {
    await exchangeCodeForIdentity(config, 'auth-code');
    expect(jwtVerify).toHaveBeenCalledWith('signed.id.token', 'jwks', { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: config.clientId });
  });

  it('sends the code with the client credentials to the Google token endpoint only', async () => {
    await exchangeCodeForIdentity(config, 'auth-code');
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: URLSearchParams }];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init.method).toBe('POST');
    expect(init.body.get('code')).toBe('auth-code');
    expect(init.body.get('grant_type')).toBe('authorization_code');
    expect(init.body.get('redirect_uri')).toBe(config.redirectUri);
  });

  it.each([
    ['email_verified is false', { email_verified: false }],
    ['email_verified is missing', { email_verified: undefined }],
    ['email_verified is the string "true"', { email_verified: 'true' }],
    ['email_verified is the number 1', { email_verified: 1 }],
    ['email_verified is null', { email_verified: null }],
    ['the e-mail is missing', { email: undefined }],
    ['the e-mail is not a string', { email: 123 }],
    ['the subject is missing', { sub: undefined }],
    ['the subject is not a string', { sub: 42 }],
  ])('rejects the identity when %s', async (_label, override) => {
    jwtVerify.mockResolvedValue({ payload: { ...claims, ...override } });
    const failure = await exchangeCodeForIdentity(config, 'auth-code').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GoogleOAuthError);
    expect((failure as Error).message).toBe('Google account without a verified email');
  });

  it('rejects a token that fails signature, issuer or audience verification', async () => {
    jwtVerify.mockRejectedValue(new Error('signature verification failed'));
    const failure = await exchangeCodeForIdentity(config, 'auth-code').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(GoogleOAuthError);
    expect((failure as Error).message).toBe('Invalid Google id_token');
  });

  it('rejects when the token endpoint refuses the code or returns no id_token', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    await expect(exchangeCodeForIdentity(config, 'bad-code')).rejects.toBeInstanceOf(GoogleOAuthError);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: 'only-access' }) });
    await expect(exchangeCodeForIdentity(config, 'auth-code')).rejects.toBeInstanceOf(GoogleOAuthError);
    expect(jwtVerify).not.toHaveBeenCalled();
  });

  it('falls back to the e-mail when Google sends no usable name', async () => {
    jwtVerify.mockResolvedValue({ payload: { ...claims, name: '   ' } });
    expect((await exchangeCodeForIdentity(config, 'auth-code')).name.toLowerCase()).toBe('person@example.com');
  });
});
