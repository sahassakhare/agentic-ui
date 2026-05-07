import { expect, test } from '../support/test-fixtures';
import { sidebar } from '../support/sidebar';

/**
 * Capability F6 — multi-modal input composer (r3 plan §9.6).
 *
 * Slice-1 surface (paperclip + drag-drop + paste-image; mic deferred
 * to slice 2) tested end-to-end against the live chat shell. These
 * tests do NOT need an LLM key — every assertion is on the composer's
 * client-side state and the transcript's multi-part rendering, not on
 * any assistant response.
 *
 *   1. Picking an accepted PDF lands a chip in the pending tray
 *      (AC-F6-1 client side: file content surfaces as multi-part).
 *
 *   2. Clicking Send moves the attachment into the transcript with
 *      the multi-part `📎 filename` rendering.
 *
 *   3. A file outside the MIME allow-list surfaces the inline
 *      composer error and is NOT added to the tray (AC-F6-5).
 *
 *   4. A file over the size cap surfaces the cap error (AC-F6-5).
 */
test.describe.configure({ mode: 'serial' });

test('AC-F6-1: paperclip → pending tray shows the attachment chip', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).waitForRemotes(3);

  // The composer's hidden file input is the picker target. setInputFiles
  // works on hidden inputs — Playwright bypasses visibility for them.
  const picker = page.locator('mvk-chat-shell input[type="file"]');
  await picker.setInputFiles({
    name: 'rubric.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 fake demo content'),
  });

  // Pending tray surfaces the chip with the filename.
  const chip = page.locator('mvk-chat-shell .pending-item', { hasText: 'rubric.pdf' });
  await expect(chip).toBeVisible({ timeout: 5_000 });
  // Send button enabled even though draft is empty (attachment alone is enough).
  const sendBtn = page.locator('mvk-chat-shell button.send');
  await expect(sendBtn).toBeEnabled();
});

test('AC-F6-1 transcript: Send renders the multi-part user message with the file link', async ({ page }) => {
  // Continues serially from the previous test — pending tray has 1 item.
  const sendBtn = page.locator('mvk-chat-shell button.send');
  await sendBtn.click();

  // User message bubble in the transcript carries the file link
  // (`📎 filename`). The 'parts' container only renders when content
  // is multi-part (not a string).
  const userMsg = page.locator('mvk-chat-shell .msg.user').last();
  await expect(userMsg).toBeVisible({ timeout: 5_000 });
  const fileLink = userMsg.locator('.file-part', { hasText: 'rubric.pdf' });
  await expect(fileLink).toBeVisible();

  // Pending tray cleared.
  await expect(page.locator('mvk-chat-shell .pending-item')).toHaveCount(0);
});

test('AC-F6-5: a non-accepted MIME surfaces the inline error; nothing added to tray', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).waitForRemotes(3);

  const picker = page.locator('mvk-chat-shell input[type="file"]');
  await picker.setInputFiles({
    name: 'evil.exe',
    mimeType: 'application/x-msdownload',
    buffer: Buffer.from('MZ binary'),
  });

  // Inline error fires; tray stays empty.
  const error = page.locator('mvk-chat-shell .composer-error');
  await expect(error).toBeVisible({ timeout: 5_000 });
  await expect(error).toContainText('not in the accepted list');
  await expect(page.locator('mvk-chat-shell .pending-item')).toHaveCount(0);
});

test('AC-F6-5: a file over the size cap surfaces the cap error', async ({ page }) => {
  await page.goto('/');
  await sidebar(page).waitForRemotes(3);

  // Default cap is 10 MB; build a 12 MB pdf-shaped buffer.
  const big = Buffer.alloc(12 * 1024 * 1024, 'x');
  const picker = page.locator('mvk-chat-shell input[type="file"]');
  await picker.setInputFiles({
    name: 'huge.pdf',
    mimeType: 'application/pdf',
    buffer: big,
  });

  const error = page.locator('mvk-chat-shell .composer-error');
  await expect(error).toBeVisible({ timeout: 5_000 });
  await expect(error).toContainText('per-file cap');
  await expect(page.locator('mvk-chat-shell .pending-item')).toHaveCount(0);
});
