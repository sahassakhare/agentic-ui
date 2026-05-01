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
  // Gemini free tier is tight on per-minute (5 RPM on 2.5-flash) and
  // per-day caps. A 12s pause between LLM-driven tests keeps us under
  // even the 5-RPM cap (5 tests * 12s = 60s rolling window).
  await new Promise((r) => setTimeout(r, 12_000));
});

export { expect };
