import { expect, test } from '../support/test-fixtures';
import { chatShell, isCoordinatorLLMReady } from '../support/chat';
import { sidebar } from '../support/sidebar';
import { personaMenu } from '../support/persona';

/**
 * Capability F1 — composable intake form (r3 plan §9.1).
 *
 * Validates AC-F1-1 in the live shell: switching persona via the
 * header dropdown toggles the supervisor-signoff section in a
 * runtime-composed form without remounting the form.
 *
 * Flow:
 *   1. Default persona (Paralegal). Ask the agent to onboard a
 *      Finance custodian. The agent calls `openCustodianIntake`,
 *      the chat shell mounts `app-custodian-intake-card`, and the
 *      composition renders four sections (Identity / Compliance /
 *      Approval / Discovery) given matter.type=securities,
 *      persona=paralegal, department=Finance.
 *   2. Switch to Lead Counsel. The Approval (supervisor signoff)
 *      section disappears — `persona !== "lead-counsel"` is now
 *      false, no dirty value, silent unmount.
 *   3. Switch back to Paralegal. Approval section reappears.
 */
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  const ok = await isCoordinatorLLMReady({ request });
  test.skip(!ok, 'Coordinator falls back to echo without GOOGLE_GENERATIVE_AI_API_KEY');
});

test('agent surfaces composed intake form with all four sections (paralegal · Finance · securities)', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).waitForRemotes(3);
  const persona = personaMenu(page);
  await persona.select('Paralegal');

  const chat = chatShell(page);
  await chat.ask(
    'Onboard a new custodian from the Finance team — open the intake form so I can fill it in.',
  );
  await chat.waitForAssistant();

  const card = await chat.waitForWidget('app-custodian-intake-card');
  await expect(card).toBeVisible();

  // All four sections render: Identity, Compliance (securities matter),
  // Approval (paralegal !== lead-counsel), Discovery (department=Finance).
  const headings = card.locator('.section-heading');
  const headingTexts = (await headings.allTextContents()).map((t) => t.trim());
  expect(headingTexts).toEqual(
    expect.arrayContaining(['Identity', 'Compliance', 'Approval', 'Discovery']),
  );

  // The four section widgets are visible by selector.
  await expect(card.locator('app-intake-identity')).toBeVisible();
  await expect(card.locator('app-intake-regulatory-consent')).toBeVisible();
  await expect(card.locator('app-intake-supervisor-picker')).toBeVisible();
  await expect(card.locator('app-intake-accounting-systems')).toBeVisible();
});

test('AC-F1-1: switching persona to Lead Counsel removes the supervisor section', async ({ page }) => {
  // Reuses the form mounted by the previous test (serial mode).
  const persona = personaMenu(page);
  const card = page.locator('app-custodian-intake-card').last();

  // Sanity: supervisor section currently visible.
  await expect(card.locator('app-intake-supervisor-picker')).toBeVisible();

  await persona.select('Lead Counsel');

  // Predicate `persona !== "lead-counsel"` is now false. Slot is clean
  // (we haven't typed anything), so the section unmounts silently.
  await expect(card.locator('app-intake-supervisor-picker')).toBeHidden({ timeout: 5_000 });
  await expect(card.locator('.drop-banner')).toBeHidden();

  // Other sections unaffected.
  await expect(card.locator('app-intake-identity')).toBeVisible();
  await expect(card.locator('app-intake-regulatory-consent')).toBeVisible();
  await expect(card.locator('app-intake-accounting-systems')).toBeVisible();
});

test('AC-F1-1: switching persona back to Paralegal re-mounts the supervisor section', async ({ page }) => {
  const persona = personaMenu(page);
  const card = page.locator('app-custodian-intake-card').last();

  await expect(card.locator('app-intake-supervisor-picker')).toBeHidden();

  await persona.select('Paralegal');
  await expect(card.locator('app-intake-supervisor-picker')).toBeVisible({ timeout: 5_000 });
});
