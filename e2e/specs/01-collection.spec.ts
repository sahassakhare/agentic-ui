import { expect, test } from '@playwright/test';
import { chatShell, isCoordinatorLLMReady } from '../support/chat';
import { sidebar } from '../support/sidebar';

/**
 * Phase 1 — collection specialist round-trip.
 *
 * Prompts:
 *   1. Add a custodian → assert custodianCard widget + dashboard row.
 *   2. Place a hold → assert legalHoldCard widget + active hold count.
 *
 * Tests are serial — the second prompt depends on the custodian
 * created by the first.
 */
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  const ok = await isCoordinatorLLMReady({ request });
  test.skip(!ok, 'Coordinator falls back to echo without GOOGLE_GENERATIVE_AI_API_KEY');
});

test('add a custodian via chat → custodianCard renders + dashboard updates', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).waitForRemotes(3);
  const before = await page.locator('mvk-kpi-card', { hasText: 'Custodians' })
    .locator('.value').textContent();

  const chat = chatShell(page);
  await chat.ask('Add Priya Patel as a custodian — email priya.patel.test@acme.example, department Engineering');
  await chat.waitForAssistant();

  // Widget assertion — custodianCard is the demo's collection widget
  const card = await chat.waitForWidget('app-custodian-card');
  await expect(card).toContainText('Priya Patel');
  await expect(card).toContainText('Engineering');

  // Dashboard side-effect: KPI count went up
  const after = await page.locator('mvk-kpi-card', { hasText: 'Custodians' })
    .locator('.value').textContent();
  expect(Number(after)).toBeGreaterThan(Number(before));
});

test('place a legal hold via chat → legalHoldCard renders + active-hold KPI updates', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).waitForRemotes(3);
  const before = Number((await page.locator('mvk-kpi-card', { hasText: 'Active holds' })
    .locator('.value').textContent()) ?? '0');

  const chat = chatShell(page);
  await chat.ask(
    'Place a legal hold on Sarah Chen covering Project Phoenix — scope: ' +
    'all emails and documents from Sarah about Project Phoenix from January 2025 onward.',
  );
  await chat.waitForAssistant();

  const card = await chat.waitForWidget('app-legal-hold-card');
  await expect(card).toContainText(/HOLD-/);
  await expect(card).toContainText('Project Phoenix');

  const after = Number((await page.locator('mvk-kpi-card', { hasText: 'Active holds' })
    .locator('.value').textContent()) ?? '0');
  expect(after).toBeGreaterThanOrEqual(before + 1);
});
