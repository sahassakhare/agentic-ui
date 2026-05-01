/**
 * Project test fixture — extends Playwright's `test` so every spec
 * automatically attaches the chat-shell transcript to the HTML report
 * after each test runs (pass or fail).
 *
 * Why: when the LLM produces unexpected output, the report's
 * screenshots can be hard to read; a plain-text dump of every
 * assistant turn is easier to scan. The attachment is conditional —
 * tests that never render `<mvk-chat-shell>` (e.g. smoke specs) get
 * nothing attached.
 *
 * Usage: import { test, expect } from '../support/test-fixtures'
 * (instead of '@playwright/test').
 */
import { test as base, expect, type Page } from '@playwright/test';

async function dumpTranscript(page: Page): Promise<string | null> {
  try {
    const shell = page.locator('mvk-chat-shell .transcript');
    if ((await shell.count()) === 0) return null;
    const text = (await shell.textContent({ timeout: 1_000 })) ?? '';
    return text.trim().length === 0 ? null : text;
  } catch {
    return null;
  }
}

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    await use(page);
    if (page.isClosed()) return;
    const transcript = await dumpTranscript(page);
    if (transcript !== null) {
      await testInfo.attach('chat-transcript.txt', {
        body: transcript,
        contentType: 'text/plain',
      });
    }
  },
});

export { expect };
