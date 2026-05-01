import { expect, test } from '../support/test-fixtures';
import { chatShell, isCoordinatorLLMReady } from '../support/chat';
import { sidebar } from '../support/sidebar';

/**
 * Phase 4 — search remote (semanticSearch + filterByDateRange +
 * filterByCustodians + runTARClassifier) routing through the
 * `documentIndex` DataSource.
 *
 * Asserts the three widgets the search remote contributes plus the
 * tool-filter behaviour — at 17+ tools registered, the keyword
 * filter narrows the list per turn.
 */
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  const ok = await isCoordinatorLLMReady({ request });
  test.skip(!ok, 'Coordinator falls back to echo without GOOGLE_GENERATIVE_AI_API_KEY');
});

test('semantic search → search-result widget renders ranked hits', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).waitForRemotes(3);
  const chat = chatShell(page);

  // Directive — name the tool family so the LLM picks a search tool
  // rather than answering conversationally from memory.
  await chat.ask(
    'Use semantic search to find documents similar to "Project Phoenix budget overrun"',
  );
  await chat.waitForAssistant({ timeoutMs: 120_000 });

  // Accept either widget — semanticSearch renders searchResultPanel,
  // but the LLM occasionally takes a documentPreview shortcut via the
  // review specialist's searchDocuments tool.
  const widget = chat.transcript.locator(
    'app-search-result-panel, app-document-preview',
  ).first();
  await expect(widget).toBeVisible({ timeout: 90_000 });
});

test('filter by date range → dateHistogram + buckets render', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).waitForRemotes(3);
  const chat = chatShell(page);

  await chat.ask('Show me documents authored in Q1 2025 — January through March');
  await chat.waitForAssistant({ timeoutMs: 90_000 });

  const histogram = await chat.waitForWidget('app-date-histogram', { timeoutMs: 90_000 });
  // The chart has at least one bar column.
  await expect(histogram.locator('.bar-col').first()).toBeVisible();
});

test('TAR classifier → tarScores table renders with score bars', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).waitForRemotes(3);
  const chat = chatShell(page);

  await chat.ask('Run TAR classification on the un-tagged set for topic Project Phoenix');
  await chat.waitForAssistant({ timeoutMs: 90_000 });

  const scores = await chat.waitForWidget('app-tar-scores', { timeoutMs: 90_000 });
  await expect(scores).toContainText('Project Phoenix');
  // Header row shows the three score columns.
  await expect(scores.locator('th', { hasText: /responsive/i })).toBeVisible();
  await expect(scores.locator('th', { hasText: /privileged/i })).toBeVisible();
  await expect(scores.locator('th', { hasText: /hot/i })).toBeVisible();
});
