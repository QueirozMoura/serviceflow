import { getE2EDatabaseUrl } from './database';

process.env.NODE_ENV = 'test';
process.env.HOST = '127.0.0.1';
process.env.PORT = '3333';
process.env.DATABASE_URL = getE2EDatabaseUrl();
process.env.CORS_ORIGIN = 'http://localhost:3000';
process.env.AUTH_COOKIE_SAME_SITE = 'lax';

await import('../../backend/src/server.ts');
