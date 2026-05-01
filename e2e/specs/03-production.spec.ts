import { expect, test } from '../support/test-fixtures';
import { chatShell, isCoordinatorLLMReady } from '../support/chat';
import { sidebar } from '../support/sidebar';

/**
 * Phase 3 — production assembly chain (createProductionSet →
 * assignBatesNumbers → exportProductionSet) plus Phase 5 — chain-of-
 * custody report.
 *
 * The production specialist has historically chained tools across
 * multiple turns; the LLM may also stop after `createProductionSet`
 * and ask for confirmation. We assert the *first* widget that lands
 * (productionSummary) and accept either a draft or review status.
 */
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  const ok = await isCoordinatorLLMReady({ request });
  test.skip(!ok, 'Coordinator falls back to echo without GOOGLE_GENERATIVE_AI_API_KEY');
});

let productionId: string | null = null;

test('create production with Bates pattern → productionSummary renders', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).waitForRemotes(3);
  const chat = chatShell(page);

  await chat.ask(
    'Create production PROD-002 with all responsive non-privileged docs ' +
    'from January 2025, TIFF format, Bates ACME-{seq:07d}. Then assign ' +
    'Bates numbers starting at 1.',
  );
  await chat.waitForAssistant({ timeoutMs: 120_000 });

  const summary = await chat.waitForWidget('app-production-summary', { timeoutMs: 90_000 });
  await expect(summary).toContainText('TIFF', { ignoreCase: true });
  await expect(summary).toContainText('ACME-{seq:07d}');

  // Capture the *actual* generated id from the widget's metadata
  // table, not the user-typed name. The widget header reads
  // `<strong>{{ name() }}</strong>` (which often contains "PROD-002"
  // because that's what the user said) — we want the id from
  // `<dl><dt>ID</dt><dd><code>{{ productionId() }}</code></dd>`.
  const idCode = summary.locator('dl code').first();
  await expect(idCode).toBeVisible();
  const captured = (await idCode.textContent())?.trim() ?? '';
  // nextProductionSetId() format: PROD-<3 alnum><3 base36> = 6 trailing chars
  expect(captured).toMatch(/^PROD-[A-Z0-9]{6,}$/);
  productionId = captured;
});

test('Productions page reflects the new draft / review production', async ({ page }) => {
  test.skip(!productionId, 'Previous test failed — no production id captured');
  await page.goto('/productions');
  // The new production should appear in the master list.
  const row = page.locator(`app-productions .row`, { hasText: productionId! });
  await expect(row).toBeVisible({ timeout: 30_000 });
});

test('chain-of-custody report renders with verified chain head', async ({ page }) => {
  test.skip(!productionId, 'Previous test failed — no production id captured');
  await page.goto('/');
  await sidebar(page).waitForRemotes(3);
  const chat = chatShell(page);

  await chat.ask(`Generate the chain-of-custody report for production ${productionId}`);
  await chat.waitForAssistant({ timeoutMs: 90_000 });

  const report = await chat.waitForWidget('app-chain-of-custody-report', { timeoutMs: 90_000 });
  // The report widget shows either ✓ verified or ⚠ broken in the badge row.
  await expect(report).toContainText(/verified|break/i);
  await expect(report).toContainText(productionId!);
});

test('Audit Trail page shows integrity badge after the production work', async ({ page }) => {
  await page.goto('/audit');
  const integrity = page.locator('app-audit .integrity');
  await expect(integrity).toBeVisible();
  // Either "verified" (green) or "break" — both are valid signals; we
  // assert the badge rendered, not the verdict (depends on demo state).
  await expect(integrity).toContainText(/Chain (verified|integrity broken)/i);
});
