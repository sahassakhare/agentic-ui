/**
 * Playwright config for the Agentic Experience Studio smoke suite.
 *
 * Isolated from the eDiscovery flagship config (different testDir + port) so the
 * two never interfere. These are UI smoke tests: they exercise the shell,
 * routing, the ⌘K palette and the designers' chrome — deliberately tolerant of
 * the catalog backend being down (they assert on chrome and client behaviour,
 * not on catalog data), so they run without the Java service.
 *
 * **Local:** `npm run test:e2e:studio` reuses an already-running
 * `ng serve agentic-experience-studio --port 4600`.
 * **CI (`CI=true`):** Playwright starts the dev server itself. The app must be
 * served with `authMode: 'disabled'` (the smoke suite does not perform OIDC
 * login) — point the serve at an env that disables auth, or run behind a stub.
 */
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env['STUDIO_BASE_URL'] ?? 'http://localhost:4600';
const REUSE = !process.env['CI'];

export default defineConfig({
  testDir: './specs-studio',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['junit', { outputFile: 'e2e/results/studio-junit.xml' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx ng serve agentic-experience-studio --port 4600',
    url: BASE_URL,
    reuseExistingServer: REUSE,
    timeout: 120_000,
  },
});
