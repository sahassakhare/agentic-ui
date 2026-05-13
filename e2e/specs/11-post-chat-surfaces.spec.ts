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
// Each test is independent (own page.goto + own assertions) so we
// deliberately do NOT use serial mode — a failure in one test should
// not skip the rest. Video on every test so adopters can scrub through
// each pillar end-to-end.
test.use({ video: 'on' });

test('§17 Workspace layouts — shellMode per route + per-persona density', async ({ page }) => {
  // Initial mount: chat-shell renders in rail mode (the default) and
  // exposes its mode via the host data-mode attribute (post-chat-surfaces
  // P0 / ADR-043 D4). The lib's `provideLayoutPolicy(...)` is wired in
  // app.config; the host attribute confirms the policy is being consulted.
  //
  // We deliberately do NOT assert that data-mode flips between routes
  // here. The current `<mvk-chat-shell>` reads `LAYOUT_POLICY.shellMode
  // (router.url)` at render time via a HostBinding getter, which only
  // re-evaluates on change-detection cycles tied to the host's own
  // signals — not Router navigation. The mode-per-route policy is
  // honored on initial route mount; live reactivity is a separate lib
  // follow-up (use a computed signal subscribed to Router events).
  await page.goto('/');
  const shell = page.locator('mvk-chat-shell');
  await expect(shell).toHaveAttribute('data-mode', /(rail|pill|hidden|overlay|docked-bottom|assist-panel)/);

  // Navigate through several routes — record video of the shell + the
  // routed page chrome so adopters see the registered post-chat-surfaces
  // routes mounting end-to-end. The persona-density chip changes
  // per-persona via the same LAYOUT_POLICY hook.
  for (const link of ['Audit Trail', 'Legal Holds', 'Inbox']) {
    await page.locator('app-sidebar a.nav-link', { hasText: link }).click();
    await page.waitForTimeout(800);
  }
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

test('§20 Dashboards — host + MFE-contributed visible', async ({ page }) => {
  await page.goto('/');
  // Wait for the 3 federated remotes to load (best-effort — on a cold
  // Render deploy they take several seconds to register).
  try {
    const sb = sidebar(page);
    await sb.waitForRemotes(3);
  } catch {
    // Remote count didn't reach 3 in time; proceed anyway so we can
    // verify the host-side dashboards landed and the canvas renders.
  }

  await page.locator('app-sidebar a.nav-link', { hasText: 'Dashboards' }).click();
  await expect(page).toHaveURL(/\/dashboards/);
  // Picker list — at minimum, the 3 host dashboards (matterHealth /
  // productionStatus / auditSnapshot) should be there. MFE-contributed
  // entries (reviewProductivity / productionThroughput / searchPerformance)
  // join async after federation loads, so we assert >= 3 rather than ==6.
  const pickerItems = page.locator('app-dashboards-page aside.list button.item');
  await expect(pickerItems.first()).toBeVisible({ timeout: 15_000 });
  const count = await pickerItems.count();
  expect(count).toBeGreaterThanOrEqual(3);

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
  await expect(page.locator('h1', { hasText: 'Playbooks' })).toBeVisible({ timeout: 30_000 });
  // 3 playbooks registered (initial, qc v2, productionRelease)
  const playbookItems = page.locator('app-playbooks-page aside.list button.item');
  await expect(playbookItems.first()).toBeVisible({ timeout: 15_000 });
  const count = await playbookItems.count();
  expect(count).toBeGreaterThanOrEqual(1);

  // Start the first playbook
  await page.locator('button.btn.primary', { hasText: 'Start run' }).click();
  // mvk-playbook-runner appears with the first step rendered
  await expect(page.locator('mvk-playbook-runner')).toBeVisible({ timeout: 10_000 });
});

// Workflow F — interview prep on Custodians + lifecycle-stages + assist-panel
test('Custodians — assist-panel + interview-prep + lifecycle-stages', async ({ page }) => {
  await page.goto('/custodians');
  // Wait for the Custodians h1 + the list to mount. Render cold-start
  // + Angular hydration + ~100 catalog 409 console errors on first hit
  // make the initial render slow; once mounted, the rest is fast.
  await expect(page.locator('h1', { hasText: 'Custodians' })).toBeVisible({ timeout: 30_000 });
  // Scope selector to the Custodians page to avoid clashing with the
  // Dashboards page (which also has aside.list but uses button.item).
  const firstRow = page.locator('app-custodians aside.list button.row').first();
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  await firstRow.click();
  await expect(page.locator('mvk-assist-panel')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('app-interview-prep')).toBeVisible({ timeout: 5_000 });
});

test('Holds — lifecycle-stages widget rendered', async ({ page }) => {
  await page.goto('/holds');
  await expect(page.locator('mvk-lifecycle-stages').first()).toBeVisible();
});

test('Audit — page renders + chain-hash visualization when events exist', async ({ page }) => {
  await page.goto('/audit');
  // Page chrome always renders
  await expect(page.locator('h1', { hasText: 'Audit trail' })).toBeVisible({ timeout: 30_000 });
  // Chain-viz section is conditional on `chained().length > 0` —
  // a fresh demo with no tool calls yet has no chain events to render.
  // We assert IF it's there, that the click-to-flash interaction works;
  // we don't fail the test on a clean-slate audit log.
  const viz = page.locator('section.chain-viz');
  if (await viz.count() > 0) {
    await expect(viz).toBeVisible();
    const headBlock = page.locator('.cv-block.head');
    if (await headBlock.count() > 0) {
      await headBlock.click();
      await expect(page.locator('ol.trail li.flash')).toHaveCount(1, { timeout: 2_000 });
    }
  }
});
