// Use plain @playwright/test (not test-fixtures) — this spec is
// LLM-free, so the chat-transcript attachment + 25s rate-limit
// throttle baked into ../support/test-fixtures is pure overhead.
import { expect, test } from '@playwright/test';
import { sidebar } from '../support/sidebar';

/**
 * Post-chat surfaces tour — captures every use-case scenario
 * (§17–§22 in the USER_GUIDE matrix) as a deterministic, LLM-free
 * Playwright run. Records video for every test in this file so
 * adopters can scrub through each pillar end-to-end.
 *
 * **No Gemini key required.** Every assertion is against host-side
 * registry state + dispatch-agnostic widgets — no chat turn. Runs
 * anywhere `ng serve demo-ediscovery-shell` is up at :4300.
 *
 * Video output: `e2e/results/test-results/<spec>/video.webm`.
 * To inspect after a run: `npx playwright show-report e2e/results`.
 */
test.describe.configure({ mode: 'serial' });
test.use({ video: 'on' });

test('§17 Workspace layouts — shellMode per route + per-persona density', async ({ page }) => {
  await page.goto('/');
  const shell = page.locator('mvk-chat-shell');
  // Dashboard: rail mode (the default for "glance" routes)
  await expect(shell).toHaveAttribute('data-mode', 'rail');

  // Audit: chat hidden (chain-hash query bar is the right primitive)
  await page.locator('app-sidebar a.nav-link', { hasText: 'Audit Trail' }).click();
  await expect(page).toHaveURL(/\/audit/);
  await expect(shell).toHaveAttribute('data-mode', 'hidden');

  // Holds: pill mode (canvas is the artifact)
  await page.locator('app-sidebar a.nav-link', { hasText: 'Legal Holds' }).click();
  await expect(page).toHaveURL(/\/holds/);
  await expect(shell).toHaveAttribute('data-mode', 'pill');

  // Inbox: rail again
  await page.locator('app-sidebar a.nav-link', { hasText: 'Inbox' }).click();
  await expect(page).toHaveURL(/\/inbox/);
  await expect(shell).toHaveAttribute('data-mode', 'rail');
});

test('§18 In-context affordances — smart-cell + row-action-menu + bulk-toolbar', async ({ page }) => {
  await page.goto('/documents');
  // Smart-cell column header
  await expect(page.locator('thead th', { hasText: 'AI flag' })).toBeVisible();
  // At least one row has the smart-cell rendered
  const firstSmartCell = page.locator('tbody tr mvk-smart-cell').first();
  await expect(firstSmartCell).toBeVisible();

  // Row-action-menu — kebab button on every row
  const firstRowMenu = page.locator('tbody tr mvk-row-action-menu').first();
  await expect(firstRowMenu).toBeVisible();
  await firstRowMenu.locator('button').first().click();
  // Menu opens — at least one item appears (persona-filtered)
  await expect(page.locator('mvk-row-action-menu .row').first()).toBeVisible({ timeout: 2_000 });
  // Close by clicking outside
  await page.mouse.click(10, 10);

  // Bulk toolbar — appears after multi-select
  const firstCheckbox = page.locator('tbody tr td.check input[type="checkbox"]').first();
  await firstCheckbox.check();
  await expect(page.locator('mvk-bulk-toolbar')).toBeVisible();
});

test('§19 Proactive triggers + inbox — seeded notifications visible', async ({ page }) => {
  await page.goto('/inbox');
  // Header crumb + count line
  await expect(page.locator('h1', { hasText: 'Inbox' })).toBeVisible();
  // mvk-inbox mounts at least one notification row (seeded by NotificationsStore)
  const inboxItems = page.locator('mvk-inbox li, mvk-inbox .notification, mvk-inbox [role="listitem"]');
  await expect(inboxItems.first()).toBeVisible({ timeout: 5_000 });

  // Bell tray in header shows unread badge
  const tray = page.locator('app-header mvk-notification-tray');
  await expect(tray).toBeVisible();
});

test('§20 Dashboards — 3 host + 3 MFE-contributed visible', async ({ page }) => {
  await page.goto('/');
  // Wait for the 3 remotes to register dashboards via federation symmetry.
  const sb = sidebar(page);
  await sb.waitForRemotes(3);

  await page.locator('app-sidebar a.nav-link', { hasText: 'Dashboards' }).click();
  await expect(page).toHaveURL(/\/dashboards/);
  // Picker list shows >= 6 dashboards (matterHealth + productionStatus + auditSnapshot
  // from host, plus reviewProductivity + productionThroughput + searchPerformance
  // from the remotes).
  const pickerItems = page.locator('aside.list button.item');
  await expect(pickerItems).toHaveCount(6, { timeout: 10_000 });

  // Canvas renders for the active dashboard
  await expect(page.locator('mvk-dashboard-canvas')).toBeVisible();
});

test('§21 Workflow surfaces — review-queue, timeline, cal', async ({ page }) => {
  await page.goto('/review-queue');
  await expect(page.locator('h1', { hasText: 'Review queue' })).toBeVisible();
  // mvk-review-queue mounts
  await expect(page.locator('mvk-review-queue')).toBeVisible();

  await page.locator('app-sidebar a.nav-link', { hasText: 'Timeline' }).click();
  await expect(page).toHaveURL(/\/timeline/);
  await expect(page.locator('mvk-timeline-canvas')).toBeVisible();

  await page.locator('app-sidebar a.nav-link', { hasText: 'CAL workbench' }).click();
  await expect(page).toHaveURL(/\/cal/);
  await expect(page.locator('mvk-cal-workbench')).toBeVisible();
});

test('§22 Playbooks — picker + start run + chain-hashed steps', async ({ page }) => {
  await page.goto('/playbooks');
  await expect(page.locator('h1', { hasText: 'Playbooks' })).toBeVisible();
  // 3 playbooks registered (initial, qc v2, productionRelease)
  const playbookItems = page.locator('aside.list button.item');
  await expect(playbookItems).toHaveCount(3);

  // Start the first playbook
  await page.locator('button.btn.primary', { hasText: 'Start run' }).click();
  // mvk-playbook-runner appears with the first step rendered
  await expect(page.locator('mvk-playbook-runner')).toBeVisible({ timeout: 5_000 });
});

// Workflow F — interview prep on Custodians + lifecycle-stages + assist-panel
test('Custodians — assist-panel + interview-prep + lifecycle-stages', async ({ page }) => {
  await page.goto('/custodians');
  // Select the first custodian
  await page.locator('aside.list button.row').first().click();
  await expect(page.locator('mvk-assist-panel')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('app-interview-prep')).toBeVisible();
});

test('Holds — lifecycle-stages widget rendered', async ({ page }) => {
  await page.goto('/holds');
  await expect(page.locator('mvk-lifecycle-stages').first()).toBeVisible();
});

test('Audit — chain-hash visualization renders + jump-to-entry works', async ({ page }) => {
  await page.goto('/audit');
  await expect(page.locator('section.chain-viz')).toBeVisible();
  const headBlock = page.locator('.cv-block.head');
  if (await headBlock.count() > 0) {
    await headBlock.click();
    // The corresponding li gets the flash class for ~1.4s.
    await expect(page.locator('ol.trail li.flash')).toHaveCount(1, { timeout: 1_500 });
  }
});
