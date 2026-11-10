import { defineConfig, devices } from '@playwright/test';

// Garante que o runner e os workers E2E utilizem exclusivamente o banco isolado e2e.db.
process.env.DATABASE_URL = 'file:./e2e.db';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: false,
    env: {
      DATABASE_URL: 'file:./e2e.db',
      JWT_SECRET: process.env.JWT_SECRET || 'e2e-isolated-test-jwt-secret-key-min-32-chars',
      ALLOW_OPERATIONAL_RESET: 'true',
      ALLOW_SIMULATED_FASE: 'false',
      TSE_FETCH_TIMEOUT_MS: '2000'
    }
  },
});
