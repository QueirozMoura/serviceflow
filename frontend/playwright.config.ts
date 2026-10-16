import { defineConfig, devices } from '@playwright/test';
import { getE2EDatabaseUrl } from './e2e/database';

const databaseUrl = getE2EDatabaseUrl();
const frontendDirectory = process.cwd();

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'npx tsx e2e/start-backend.ts',
      cwd: frontendDirectory,
      url: 'http://127.0.0.1:3333/api/auth/session',
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        HOST: '127.0.0.1',
        PORT: '3333',
        DATABASE_URL: databaseUrl,
        CORS_ORIGIN: 'http://localhost:3000',
        AUTH_COOKIE_SAME_SITE: 'lax',
        // A suite inteira roda do mesmo IP em poucos segundos; o limite padrao (100/min) gera 429 entre testes.
        RATE_LIMIT_MAX: '1000',
      },
    },
    {
      command: 'npm run dev -- --host localhost --port 3000',
      cwd: frontendDirectory,
      url: 'http://localhost:3000',
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
