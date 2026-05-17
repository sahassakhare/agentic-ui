import { expect, test } from '../support/test-fixtures';
import { chatShell, isCoordinatorLLMReady } from '../support/chat';
import { sidebar } from '../support/sidebar';

/**
 * Capability F5 — Long-running operations (r3 plan §9.5).
 *
 * Validates the end-to-end flow in the live shell:
 *
 *   1. Agent calls `runTARClassifier` from a chat prompt. Tool
 *      returns immediately; chat renders `mvk-operation-progress`
 *      inline (AC-F5-1).
 *
 *   2. Sidebar "Operations" badge ticks to >=1 while the background
 *      loop streams progress.
 *
 *   3. Navigate to /operations — the same progress widget renders
 *      under "Active". Progress percentage advances visibly
 *      (AC-F5-3 within-session: panel shows in-flight ops).
 *
 *   4. Wait for terminal-success — the widget swaps to its
 *      finished state (AC-F5-1 terminal). The operations page's
 *      "Recently completed" section now lists the row.
 *
 *   5. Audit-trail page shows operation-* rows for the lifecycle
 *      (AC-F5-5 + AC-F5-6 in the eDiscovery shell).
 *
 * Skips when the coordinator is in echo mode (no LLM key).
 */
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  const ok = await isCoordinatorLLMReady({ request });
  test.skip(!ok, 'Coordinator falls back to echo without GOOGLE_GENERATIVE_AI_API_KEY');
});

test('AC-F5-1: TAR classifier returns immediately + inline progress widget mounts', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).waitForRemotes(3);

  const chat = chatShell(page);
  await chat.ask('Run TAR classification on the un-tagged corpus for the topic "SEC inquiry".');
  await chat.waitForAssistant();

  // Inline progress widget mounts with the synthetic `mvk-operation-progress` reference.
  const progressCard = page.locator('mvk-operation-progress').first();
  await expect(progressCard).toBeVisible({ timeout: 15_000 });

  // Synchronous-ish opening state: the widget shows started (or progress
  // by the time we arrive). Either way it has a progress bar.
  await expect(progressCard.locator('[role="progressbar"]')).toBeVisible();
});

test('Sidebar "Operations" badge ticks while in flight', async ({ page }) => {
  // The previous test left an in-flight LRO on the page.
  const opsNav = page.locator('app-sidebar .nav-link', { hasText: 'Operations' });
  await expect(opsNav).toBeVisible();
  await expect(opsNav.locator('.badge')).toBeVisible({ timeout: 5_000 });
});

test('AC-F5-3: /operations page lists the active operation; progress advances visibly', async ({ page }) => {
  const opsNav = page.locator('app-sidebar .nav-link', { hasText: 'Operations' });
  await opsNav.click();
  await expect(page.locator('h1', { hasText: 'Operations' })).toBeVisible();

  const activeCard = page.locator('app-operations mvk-operation-progress').first();
  await expect(activeCard).toBeVisible();

  // Capture initial pct, then assert it advances within a few seconds.
  const bar = activeCard.locator('[role="progressbar"]');
  const initial = Number((await bar.getAttribute('aria-valuenow')) ?? '0');

  await expect(async () => {
    const cur = Number((await bar.getAttribute('aria-valuenow')) ?? '0');
    expect(cur).toBeGreaterThan(initial);
  }).toPass({ timeout: 6_000 });
});

test('AC-F5-1 terminal: operation completes; widget swaps to finished state', async ({ page }) => {
  const card = page.locator('app-operations mvk-operation-progress').first();
  // The TAR demo runs ~12s total; allow generous timeout for slow CI.
  await expect(card.locator('.op[data-status="finished"]')).toBeVisible({ timeout: 30_000 });
  // Sidebar badge clears once active=0.
  const opsNav = page.locator('app-sidebar .nav-link', { hasText: 'Operations' });
  await expect(opsNav.locator('.badge')).toHaveCount(0);
});

test('AC-F5-5: audit-trail page shows operation-* lifecycle rows', async ({ page }) => {
  await page.click('app-sidebar .nav-link:has-text("Audit Trail")');
  await expect(page.locator('h1', { hasText: /Audit/ })).toBeVisible();

  // operation-started, operation-progress, operation-finished should all appear.
  await expect(page.locator('text=/operation[ -]started/i').first()).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('text=/operation[ -]finished/i').first()).toBeVisible({ timeout: 5_000 });
});
