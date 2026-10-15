import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryDirectory = resolve(frontendDirectory, '..', '..');
const backendDirectory = resolve(repositoryDirectory, 'backend');
export const E2E_DATABASE_NAME = 'serviceflow_e2e';

function readBackendDatabaseUrl(): string {
  const envFile = readFileSync(resolve(backendDirectory, '.env'), 'utf8');
  const line = envFile.split('\n').find((entry) => entry.startsWith('DATABASE_URL='));
  const value = line?.slice('DATABASE_URL='.length).trim().replace(/^(["'])(.*)\1$/, '$2');
  if (!value) throw new Error('E2E requires DATABASE_URL in backend/.env');
  return value;
}

function assertLocalDatabase(url: URL): void {
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('E2E database must use a local PostgreSQL host');
  }
}

export function getE2EDatabaseUrl(): string {
  const url = new URL(process.env.SERVICEFLOW_E2E_BASE_URL ?? readBackendDatabaseUrl());
  assertLocalDatabase(url);
  url.pathname = `/${E2E_DATABASE_NAME}`;
  return url.toString();
}

function getMaintenanceUrl(): string {
  const url = new URL(getE2EDatabaseUrl());
  url.pathname = '/postgres';
  return url.toString();
}

function runPsql(databaseUrl: string, sql: string): void {
  const url = new URL(databaseUrl);
  url.search = '';
  execFileSync('psql', [url.toString(), '-v', 'ON_ERROR_STOP=1', '-c', sql], { stdio: 'inherit' });
}

export function prepareE2EDatabase(): void {
  runPsql(getMaintenanceUrl(), `DROP DATABASE IF EXISTS "${E2E_DATABASE_NAME}" WITH (FORCE)`);
  runPsql(getMaintenanceUrl(), `CREATE DATABASE "${E2E_DATABASE_NAME}"`);
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: backendDirectory,
    env: { ...process.env, DATABASE_URL: getE2EDatabaseUrl(), NODE_ENV: 'test' },
    stdio: 'inherit',
    
  });
}

export function destroyE2EDatabase(): void {
  runPsql(getMaintenanceUrl(), `DROP DATABASE IF EXISTS "${E2E_DATABASE_NAME}" WITH (FORCE)`);
}
