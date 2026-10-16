import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1'];

function baseUrl(): URL {
  let raw = process.env.SERVICEFLOW_TEST_DATABASE_URL;
  if (!raw) {
    const line = readFileSync(resolve(backendDirectory, '.env'), 'utf8').split('\n').find((entry) => entry.startsWith('DATABASE_URL='));
    raw = line?.slice('DATABASE_URL='.length).trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  if (!raw) throw new Error('Integration tests need SERVICEFLOW_TEST_DATABASE_URL or DATABASE_URL in backend/.env (only used to reach a local server)');
  const url = new URL(raw);
  // Nunca roda contra um servidor remoto: o banco usado e sempre um banco temporario em localhost.
  if (!LOCAL_HOSTS.includes(url.hostname)) throw new Error('Integration tests only run against a local PostgreSQL server');
  url.search = '';
  return url;
}

function withDatabase(url: URL, name: string): string {
  const copy = new URL(url.toString());
  copy.pathname = `/${name}`;
  return copy.toString();
}

function psql(url: string, sql: string): void {
  execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql], { stdio: 'inherit' });
}

export interface TemporaryDatabase {
  name: string;
  url: string;
  drop(): void;
}

/** Cria um banco novo e vazio (nome aleatorio), aplica as migracoes existentes e devolve como remove-lo. */
export function createTemporaryDatabase(prefix: string): TemporaryDatabase {
  const server = baseUrl();
  const name = `serviceflow_it_${prefix}_${randomBytes(4).toString('hex')}`;
  const maintenance = withDatabase(server, 'postgres');
  const url = withDatabase(server, name);

  psql(maintenance, `CREATE DATABASE "${name}"`);
  const drop = () => psql(maintenance, `DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  try {
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: backendDirectory, env: { ...process.env, DATABASE_URL: url, NODE_ENV: 'test' }, stdio: 'ignore' });
  } catch (error) {
    drop();
    throw error;
  }
  return { name, url, drop };
}
