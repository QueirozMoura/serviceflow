import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../../config/env.js';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export class GoogleOAuthConfigError extends Error {
  constructor() {
    super('Google OAuth is not configured');
    this.name = 'GoogleOAuthConfigError';
  }
}

export class GoogleOAuthError extends Error {
  constructor(message = 'Google authentication failed') {
    super(message);
    this.name = 'GoogleOAuthError';
  }
}

/** Le a configuracao do Google do ambiente, falhando quando incompleta. */
export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new GoogleOAuthConfigError();
  }
  return { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri: GOOGLE_REDIRECT_URI };
}

export function isGoogleOAuthEnabled(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI);
}

/** Monta a URL de consentimento do Google para o fluxo Authorization Code. */
export function buildGoogleAuthorizationUrl(config: GoogleOAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

export interface GoogleIdentity {
  providerAccountId: string;
  email: string;
  name: string;
}

interface IdTokenPayload {
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  name?: unknown;
}

/** Troca o code por tokens e valida o id_token do Google. */
export async function exchangeCodeForIdentity(config: GoogleOAuthConfig, code: string): Promise<GoogleIdentity> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) throw new GoogleOAuthError('Google token exchange failed');

  const tokens = (await response.json()) as { id_token?: unknown };
  if (typeof tokens.id_token !== 'string') throw new GoogleOAuthError('Google did not return an id_token');

  let payload: IdTokenPayload;
  try {
    const { payload: verified } = await jwtVerify(tokens.id_token, GOOGLE_JWKS, {
      issuer: GOOGLE_ISSUERS,
      audience: config.clientId,
    });
    payload = verified as IdTokenPayload;
  } catch {
    throw new GoogleOAuthError('Invalid Google id_token');
  }

  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string' || payload.email_verified !== true) {
    throw new GoogleOAuthError('Google account without a verified email');
  }

  return {
    providerAccountId: payload.sub,
    email: payload.email.toLowerCase(),
    name: typeof payload.name === 'string' && payload.name.trim().length > 0 ? payload.name.trim() : payload.email,
  };
}
