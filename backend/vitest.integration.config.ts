import { defineConfig } from 'vitest/config';

// Testes que usam um PostgreSQL local real (banco temporario). Rode com: npm run test:integration
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/integration/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
