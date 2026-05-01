/**
 * Playwright config for the eDiscovery flagship.
 *
 * @remarks
 * **Local flow.** Run all five services yourself (`ng serve` for the
 * shell + 3 remotes, `npx tsx src/server.ts` for the agent server) —
 * Playwright's `webServer` block reuses them. Faster iteration; no
 * cold-start lottery on Gemini's quota.
 *
 * **CI flow.** Set `CI=true`. Playwright spawns the four web dev
 * servers + the Hono backend before the suite, tears them down
 * after. Slower (~60s warm-up) but hands-off.
 *
 * **Gemini key.** Tests need a real Gemini key in
 * `examples/demo-ediscovery-server/.env` (or in the env when CI
 * spawns the backend). Tests skip with `test.skip` if the
 * coordinator returns `coordinator: 'echo-placeholder'` from
 * `/health` — see the global setup.
 */
import { defineConfig, devices } from '@playwright/test';

const BASE_URL    = process.env['EDIS_BASE_URL']  ?? 'http://localhost:4300';
const SERVER_URL  = process.env['EDIS_SERVER']    ?? 'http://localhost:4311';
const REUSE       = !process.env['CI'];

export default defineConfig({
  testDir: './specs',
  // LLM round-trips can take 10-20s under load; tool chains 3x that.
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,            // serial: state mutates across tests within a file
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: process.env['CI'] ? [['list'], ['junit', { outputFile: 'e2e/results/junit.xml' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'on',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Spawned only on CI — locally we expect you to have ng serve already running.
  webServer: process.env['CI']
    ? [
        {
          command: 'cd examples/demo-ediscovery-server && npx tsx src/server.ts',
          url: `${SERVER_URL}/health`,
          timeout: 60_000,
          reuseExistingServer: REUSE,
        },
        {
          command: 'npx ng serve demo-ediscovery-shell --port 4300',
          url: BASE_URL,
          timeout: 240_000,
          reuseExistingServer: REUSE,
        },
        {
          command: 'npx ng serve demo-ediscovery-review --port 4302',
          url: 'http://localhost:4302',
          timeout: 240_000,
          reuseExistingServer: REUSE,
        },
        {
          command: 'npx ng serve demo-ediscovery-production --port 4303',
          url: 'http://localhost:4303',
          timeout: 240_000,
          reuseExistingServer: REUSE,
        },
        {
          command: 'npx ng serve demo-ediscovery-search --port 4304',
          url: 'http://localhost:4304',
          timeout: 240_000,
          reuseExistingServer: REUSE,
        },
      ]
    : undefined,
});
