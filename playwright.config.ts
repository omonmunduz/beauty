import { defineConfig, devices } from '@playwright/test';

// Runs against the local stack: `supabase start` + `pnpm setup:local` + Vite dev server.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  // Projects share one studio and race for the same first free slot otherwise (which the app
  // correctly rejects as slot_taken) — run them one after another.
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: 'pnpm exec vite', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 120_000 },
});
