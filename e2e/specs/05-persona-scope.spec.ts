import { expect, test } from '../support/test-fixtures';
import { sidebar } from '../support/sidebar';
import { personaMenu } from '../support/persona';

/**
 * Phases 7 + 8 — persona scope policy.
 *
 * Pure UI test (no LLM call). Validates that the
 * `RegistryBase.setScopePolicy` shipped in 1.1.0 actually filters
 * the live tool view per persona:
 *   - Lead Counsel sees every tool (allow-list `['*']`).
 *   - Vendor Reviewer sees the smallest set (read + tag only).
 *   - Switching personas in the header dropdown updates BOTH the
 *     persona-menu badges AND the sidebar's tool counter live.
 *
 * Runs without GOOGLE_GENERATIVE_AI_API_KEY — no agent involvement.
 */
test.describe.configure({ mode: 'serial' });

test('persona menu shows per-role tool count badges', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).waitForRemotes(3);
  const persona = personaMenu(page);
  await persona.open();

  const lead    = await persona.toolCountFor('Lead Counsel');
  const associate = await persona.toolCountFor('Associate');
  const paralegal = await persona.toolCountFor('Paralegal');
  const vendor    = await persona.toolCountFor('Vendor Reviewer');

  // Total is the same across every row (they all read the same registry).
  expect(associate.total).toBe(lead.total);
  expect(paralegal.total).toBe(lead.total);
  expect(vendor.total).toBe(lead.total);

  // Lead counsel sees every registered tool.
  expect(lead.allowed).toBe(lead.total);
  // Strict ordering of the demo's allow-lists:
  // lead > associate > paralegal > vendor.
  expect(lead.allowed).toBeGreaterThan(associate.allowed);
  expect(associate.allowed).toBeGreaterThan(paralegal.allowed);
  expect(paralegal.allowed).toBeGreaterThan(vendor.allowed);
});

test('switching to Vendor Reviewer drops the sidebar tool counter live', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).waitForRemotes(3);
  const persona = personaMenu(page);

  // Start on Lead Counsel — tool counter should show every registered tool.
  await persona.select('Lead Counsel');
  const sb = sidebar(page);
  const fullCount = await sb.toolCount();
  expect(fullCount).toBeGreaterThanOrEqual(17);

  // Switch to Vendor Reviewer — counter should drop.
  await persona.select('Vendor Reviewer');
  await expect(async () => {
    const c = await sb.toolCount();
    expect(c).toBeLessThan(fullCount);
  }).toPass({ timeout: 5_000 });

  const vendorCount = await sb.toolCount();
  expect(vendorCount).toBeLessThan(fullCount);
  expect(vendorCount).toBeGreaterThan(0);
});

test('persona selection persists across navigation', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).waitForRemotes(3);
  // Don't wait for `networkidle` — ng-serve keeps a livereload websocket
  // open indefinitely, so it never fires. The waitForRemotes() above is
  // the right "app is hydrated" signal: 3 federated remotes registered
  // means the bootstrap path is done.
  const persona = personaMenu(page);

  await persona.select('Paralegal');
  expect(await persona.active()).toMatch(/Paralegal/);

  // Navigate to a different route — sessionStorage-backed selection should hold.
  await page.click('app-sidebar .nav-link:has-text("Documents")');
  await expect(page.locator('h1', { hasText: /Documents/ })).toBeVisible();
  expect(await persona.active()).toMatch(/Paralegal/);
});
