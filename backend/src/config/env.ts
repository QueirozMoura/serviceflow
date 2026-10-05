import 'dotenv/config';
import { z } from 'zod';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3333),
    DATABASE_URL: z.string().startsWith('postgresql://').or(z.string().startsWith('postgres://')),
    CORS_ORIGIN: z.string().min(1).default('http://localhost:3000'),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    RATE_LIMIT_WINDOW: z.string().min(1).default('1 minute'),
    AUTH_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
    AUTH_COOKIE_NAME: z.string().regex(/^[a-zA-Z0-9_-]+$/).default('serviceflow_session'),
    AUTH_COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    // Numero de proxies reversos a confiar para o IP real (X-Forwarded-For).
    // false desabilita; true confia em todos; integer confia em N hops.
    TRUST_PROXY: z
      .enum(['true', 'false'])
      .or(z.coerce.number().int().min(0))
      .default('false')
      .transform((value) => (value === 'true' ? true : value === 'false' ? false : String(value))),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    // URL publica do callback registrada no Google Cloud Console.
    // Ex.: https://serviceflow-15yc.onrender.com/api/auth/google/callback
    GOOGLE_REDIRECT_URI: z.string().url().optional(),
    // Para onde redirecionar o navegador apos autenticar (frontend).
    OAUTH_SUCCESS_REDIRECT: z.string().url().optional(),
    // Para onde redirecionar quando o fluxo OAuth falha (frontend /login).
    OAUTH_FAILURE_REDIRECT: z.string().url().optional(),
  })
  .superRefine((value, context) => {
    const origins = value.CORS_ORIGIN.split(',').map((origin) => origin.trim());
    const invalidOrigins = origins.some((origin) => {
      if (!origin) return true;
      try {
        return LOCAL_HOSTS.has(new URL(origin).hostname);
      } catch {
        return true;
      }
    });

    // SameSite=None so funciona com cookies Secure (HTTPS) e destina-se a producao.
    if (value.AUTH_COOKIE_SAME_SITE === 'none' && value.NODE_ENV !== 'production') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_COOKIE_SAME_SITE'],
        message: "AUTH_COOKIE_SAME_SITE 'none' is only allowed in production (requires HTTPS/Secure)",
      });
    }

    if (value.NODE_ENV !== 'production') return;

    // Em producao o servidor precisa aceitar conexoes da rede/plataforma de deploy.
    if (LOCAL_HOSTS.has(value.HOST)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['HOST'],
        message: 'HOST must bind to 0.0.0.0 (or a public interface) in production',
      });
    }

    // Cookies de sessao sao cross-site em producao; uma origem localhost nao funciona.
    if (invalidOrigins) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGIN'],
        message: 'CORS_ORIGIN must list the real frontend origin(s) in production',
      });
    }

    // Se o Google OAuth estiver habilitado, todas as variaveis devem estar definidas.
    const googleKeys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'OAUTH_SUCCESS_REDIRECT'] as const;
    const provided = googleKeys.filter((key) => value[key] !== undefined);
    if (provided.length > 0 && provided.length !== googleKeys.length) {
      for (const key of googleKeys) {
        if (value[key] === undefined) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${key} is required when Google OAuth is enabled`,
          });
        }
      }
    }
  });

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment configuration:', result.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const env = result.data;
export type Env = typeof env;
