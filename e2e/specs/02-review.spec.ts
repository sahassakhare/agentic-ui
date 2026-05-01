import { expect, test } from '@playwright/test';
import { chatShell, isCoordinatorLLMReady } from '../support/chat';
import { sidebar } from '../support/sidebar';

/**
 * Phase 2 — federated review remote.
 *
 * Prompts:
 *   1. Search documents about Project Phoenix → assert documentPreview cards.
 *   2. Mark a specific seed doc as attorney-client privileged → assert
 *      the privilege flag appears in the post-mutation card.
 *
 * Uses the seed dataset's known doc id (DOC-7891236 — the
 * memo-attorney-client.docx authored by James O'Brien) so we can
 * make exact-match assertions without depending on LLM phrasing.
 */
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  const ok = await isCoordinatorLLMReady({ request });
  test.skip(!ok, 'Coordinator falls back to echo without GOOGLE_GENERATIVE_AI_API_KEY');
});

test('search documents → documentPreview widget renders ranked results', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).waitForRemotes(3);
  const chat = chatShell(page);

  await chat.ask('Find documents about Project Phoenix');
  await chat.waitForAssistant({ timeoutMs: 90_000 });

  // The review specialist may call either searchDocuments (review remote)
  // or semanticSearch (search remote) depending on routing; both render
  // a card with the matching docs. We accept either widget shape.
  const docPreview = chat.transcript.locator('app-document-preview');
  const searchPanel = chat.transcript.locator('app-search-result-panel');
  await expect(docPreview.first().or(searchPanel.first())).toBeVisible({ timeout: 60_000 });

  const cardText = (await chat.transcript.textContent()) ?? '';
  expect(cardText.toLowerCase()).toContain('phoenix');
});

test('mark a seed doc as attorney-client privileged → card flips to privileged', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).waitForRemotes(3);
  const chat = chatShell(page);

  await chat.ask(
    'Mark DOC-7891236 as attorney-client privileged — the memo-attorney-client.docx ' +
    'is a privileged communication between counsel and client about the SEC inquiry.',
  );
  await chat.waitForAssistant({ timeoutMs: 90_000 });

  const card = chat.transcript.locator('app-document-preview').last();
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText('attorney-client');
  await expect(card).toContainText('DOC-7891236');
});
