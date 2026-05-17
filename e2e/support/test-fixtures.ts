/**
 * Project test base — extends Playwright's `test` so every spec
 * automatically attaches the chat-shell transcript to the HTML report
 * after each test runs (pass or fail).
 *
 * Why: when the LLM produces unexpected output, the report's
 * screenshots can be hard to read; a plain-text dump of every
 * assistant turn is easier to scan. The attachment is conditional —
 * tests that never render `<mvk-chat-shell>` (e.g. smoke specs) or
 * leave the transcript empty get nothing attached.
 *
 * Usage: import { test, expect } from '../support/test-fixtures'
 * (instead of '@playwright/test').
 */
import { test as base, expect } from '@playwright/test';

export const test = base.extend({});

test.afterEach(async ({ page }, testInfo) => {
  if (page.isClosed()) return;
  try {
    const shell = page.locator('mvk-chat-shell .transcript');
    if ((await shell.count()) === 0) return;
    const text = (await shell.textContent({ timeout: 2_000 })) ?? '';
    if (text.trim().length === 0) return;
    await testInfo.attach('chat-transcript.txt', {
      body: text,
      contentType: 'text/plain',
    });
  } catch {
    // page closed mid-teardown — nothing to capture.
  }
  // Gemini free tier 5 RPM is tight. A 25s throttle between LLM tests
  // gives the rolling-minute window most of its way to clearing before
  // the next test starts; server-side retry (gemini-agent.ts) catches
  // anything still over the line. Combined with single-op prompts in
  // each spec (avoid "do X then Y" chains) this fits the budget.
  await new Promise((r) => setTimeout(r, 25_000));
});

export { expect };
