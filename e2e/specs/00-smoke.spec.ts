import { expect, test } from '../support/test-fixtures';
import { sidebar } from '../support/sidebar';

/**
 * Boot smoke — runs without an LLM. Validates:
 *   - Host shell loads
 *   - All three federated remotes register (3 in CapabilityRegistry)
 *   - 17+ tools register (5 host + 4 review + 5 production + 4 search)
 *   - Sidebar nav renders all six routes
 *
 * If this fails, something structural is wrong — every other spec
 * will fail too. Run this first.
 */
test.describe.configure({ mode: 'serial' });

test('shell + remotes + dashboard render', async ({ page }) => {
  await page.goto('/');
  // Brand mark in the top-left of the sidebar
  await expect(page.locator('app-sidebar .brand-label strong')).toHaveText('Maverick');
  // All six routes
  for (const label of ['Dashboard', 'Documents', 'Custodians', 'Legal Holds', 'Audit Trail', 'Productions']) {
    await expect(page.locator('app-sidebar .nav-link', { hasText: label })).toBeVisible();
  }
  // Federation handoff completes — three remotes loaded
  const sb = sidebar(page);
  await sb.waitForRemotes(3);
  expect(await sb.remoteCount()).toBe(3);
  expect(await sb.toolCount()).toBeGreaterThanOrEqual(17);
  // Dashboard shows seed data
  await expect(page.locator('h1', { hasText: 'Matter snapshot' })).toBeVisible();
  await expect(page.locator('mvk-kpi-card', { hasText: 'Custodians' })).toBeVisible();
});

test('chat shell mounts with backend pill', async ({ page }) => {
  await page.goto('/');
  // Backend pill from `<mvk-chat-shell>` shows the active backend.
  // We don't assert the label string (could be 'AG-UI', 'AG-UI agent', etc. depending on lib version)
  // — just that the shell mounted and the composer is interactive.
  await expect(page.locator('mvk-chat-shell .composer input')).toBeEnabled();
  await expect(page.locator('mvk-chat-shell .header .backend-pill')).toBeVisible();
});
