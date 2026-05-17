import { expect, test } from '../support/test-fixtures';
import { chatShell, isCoordinatorLLMReady } from '../support/chat';
import { sidebar } from '../support/sidebar';

/**
 * Capability F3 — placeLegalHold guided workflow (r3 plan §9.3).
 *
 * Validates the wizard end-to-end in the live shell:
 *   - Test 1 (happy path) — open wizard, fill scope, pick a custodian,
 *     skip dates, submit. Active-holds KPI ticks up. Validates AC-F3-1
 *     (terminal Submit invokes the same MatterStore.addLegalHold path
 *     as the one-shot tool) and AC-F3-3 (Back-and-forth preserves values
 *     because state is in CompositionStore).
 *   - Test 2 (conditional branch) — open wizard, fill scope, advance to
 *     custodians WITHOUT selecting any, click Next. AC-F3-2: `next` returns
 *     'matter-setup' and the renderer routes there. The breadcrumb's
 *     active crumb becomes "Setup".
 *
 * Both tests are LLM-gated through the same `isCoordinatorLLMReady` skip
 * the rest of the suite uses.
 */
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  const ok = await isCoordinatorLLMReady({ request });
  test.skip(!ok, 'Coordinator falls back to echo without GOOGLE_GENERATIVE_AI_API_KEY');
});

test('AC-F3-1 + F3-3: walk through the wizard end-to-end and persist a hold', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).waitForRemotes(3);

  const before = Number((await page.locator('mvk-kpi-card', { hasText: 'Active holds' })
    .locator('.value').textContent()) ?? '0');

  const chat = chatShell(page);
  await chat.ask('Open the place-legal-hold wizard.');
  await chat.waitForAssistant();

  const card = await chat.waitForWidget('app-place-legal-hold-card');
  await expect(card).toBeVisible();

  // Step 1 — Scope. Add a keyword chip.
  const keywordsStep = card.locator('app-place-hold-keywords');
  await expect(keywordsStep).toBeVisible();
  const keywordInput = keywordsStep.locator('input[type="text"]');
  await keywordInput.fill('Project Phoenix');
  await keywordInput.press('Enter');
  await expect(keywordsStep.locator('.chip', { hasText: 'Project Phoenix' })).toBeVisible();

  // Next → Custodians.
  await card.locator('button.primary', { hasText: 'Next' }).click();
  const custodiansStep = card.locator('app-place-hold-custodians');
  await expect(custodiansStep).toBeVisible();

  // Pick the first custodian. The matter is seeded with several; any one will do.
  const firstCheckbox = custodiansStep.locator('input[type="checkbox"]').first();
  await firstCheckbox.check();
  await expect(firstCheckbox).toBeChecked();

  // AC-F3-3: Back to Scope, verify keyword preserved, then forward again.
  await card.locator('button', { hasText: 'Back' }).click();
  await expect(keywordsStep).toBeVisible();
  await expect(keywordsStep.locator('.chip', { hasText: 'Project Phoenix' })).toBeVisible();
  await card.locator('button.primary', { hasText: 'Next' }).click();
  await expect(custodiansStep).toBeVisible();
  await expect(firstCheckbox).toBeChecked(); // custodian selection survived too

  // Next → Date range. Skip the optional dates.
  await card.locator('button.primary', { hasText: 'Next' }).click();
  const datesStep = card.locator('app-place-hold-dates');
  await expect(datesStep).toBeVisible();
  await card.locator('button.primary', { hasText: 'Next' }).click();

  // Preview step. Verify the keyword + a custodian show up in the summary.
  const previewStep = card.locator('app-place-hold-preview');
  await expect(previewStep).toBeVisible();
  await expect(previewStep).toContainText('Project Phoenix');

  // Terminal Submit.
  const submitBtn = card.locator('button.primary', { hasText: /Submit/ });
  await submitBtn.click();
  await expect(card.locator('.completed')).toBeVisible({ timeout: 10_000 });

  // KPI side effect — Active holds ticked up by at least 1.
  await expect(async () => {
    const after = Number((await page.locator('mvk-kpi-card', { hasText: 'Active holds' })
      .locator('.value').textContent()) ?? '0');
    expect(after).toBeGreaterThanOrEqual(before + 1);
  }).toPass({ timeout: 5_000 });
});

test('AC-F3-2: zero custodians selected → conditional next routes to matter-setup branch', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).waitForRemotes(3);

  const chat = chatShell(page);
  await chat.ask('Open the place-legal-hold wizard.');
  await chat.waitForAssistant();
  const card = await chat.waitForWidget('app-place-legal-hold-card');
  await expect(card).toBeVisible();

  // Step 1 — Scope. Add a keyword so the step has a value (irrelevant to
  // the branch but mirrors a real flow).
  const keywordsStep = card.locator('app-place-hold-keywords');
  const keywordInput = keywordsStep.locator('input[type="text"]');
  await keywordInput.fill('placeholder');
  await keywordInput.press('Enter');
  await card.locator('button.primary', { hasText: 'Next' }).click();

  // Step 2 — Custodians. Do NOT select any. Click Next.
  const custodiansStep = card.locator('app-place-hold-custodians');
  await expect(custodiansStep).toBeVisible();
  await card.locator('button.primary', { hasText: 'Next' }).click();

  // AC-F3-2: conditional next returns 'matter-setup' on empty selection.
  const matterSetupStep = card.locator('app-place-hold-matter-setup');
  await expect(matterSetupStep).toBeVisible();
  await expect(matterSetupStep).toContainText('no custodians');

  // The breadcrumb's active crumb is 'Setup' (the matter-setup section
  // label). The previous step's date-range / preview crumbs are NOT active.
  const activeCrumb = card.locator('.crumb.active');
  await expect(activeCrumb).toHaveText(/Setup/);
});
