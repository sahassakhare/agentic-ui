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
  // LLM round-trips run 10-20s under load; tool chains 3x that. Plus the
  // agent server retries 429s honoring Gemini's RetryInfo (up to 65s) so
  // a single test may absorb one full retry — bump to 180s.
  timeout: 180_000,
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
  // `cwd: '..'` because Playwright runs webServer commands from the config's
  // directory (`e2e/`); ng + tsx need to see the repo root's angular.json.
  webServer: process.env['CI']
    ? [
        {
          // Server uses `import 'dotenv/config'` which reads from cwd —
          // run from its own dir so `.env` is found.
          command: 'npx tsx src/server.ts',
          cwd: '../examples/demo-ediscovery-server',
          url: `${SERVER_URL}/health`,
          timeout: 60_000,
          reuseExistingServer: REUSE,
        },
        {
          command: 'npx ng serve demo-ediscovery-shell --port 4300',
          cwd: '..',
          url: BASE_URL,
          timeout: 240_000,
          reuseExistingServer: REUSE,
        },
        {
          command: 'npx ng serve demo-ediscovery-review --port 4302',
          cwd: '..',
          url: 'http://localhost:4302',
          timeout: 240_000,
          reuseExistingServer: REUSE,
        },
        {
          command: 'npx ng serve demo-ediscovery-production --port 4303',
          cwd: '..',
          url: 'http://localhost:4303',
          timeout: 240_000,
          reuseExistingServer: REUSE,
        },
        {
          command: 'npx ng serve demo-ediscovery-search --port 4304',
          cwd: '..',
          url: 'http://localhost:4304',
          timeout: 240_000,
          reuseExistingServer: REUSE,
        },
      ]
    : undefined,
});
