/**
 * One-off Playwright script that drives the eDiscovery shell, sends
 * the canonical "Add Sarah Chen as a custodian" prompt, waits for the
 * `app-custodian-card` widget to render, and saves a hero screenshot
 * of the chat shell area for the README.
 *
 * Prereqs (the same five services the e2e suite needs):
 *   :4300 demo-ediscovery-shell
 *   :4302 demo-ediscovery-review
 *   :4303 demo-ediscovery-production
 *   :4304 demo-ediscovery-search
 *   :4311 demo-ediscovery-server (with a real Gemini key)
 *
 * Run:
 *   node scripts/capture-readme-screenshot.mjs
 *
 * The capture targets the right-rail chat shell at ~1400px wide so the
 * resulting PNG renders cleanly inside the README's natural width on
 * github.com (max ~1012px) without aliasing.
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const BASE_URL = process.env.EDIS_BASE_URL ?? 'http://localhost:4300';
const OUT_PATH = process.argv[2] ?? 'docs/assets/agentic-ui-in-action.png';

async function main() {
  await mkdir('docs/assets', { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2, // retina-quality
  });
  const page = await context.newPage();

  console.log(`→ navigating to ${BASE_URL}`);
  await page.goto(BASE_URL);

  // Wait for the host to register all 3 federated remotes before driving chat.
  // (Same signal the e2e suite uses — `<aside class="...">` text "3 remotes".)
  await page.waitForSelector('app-sidebar', { timeout: 30_000 });
  console.log('→ shell mounted');

  // The chat shell mounts after ng serve's federation handshake completes.
  await page.waitForSelector('mvk-chat-shell', { timeout: 30_000 });
  console.log('→ chat shell mounted');

  // Drive the chat: type the prompt, send, wait for the assistant's
  // app-custodian-card widget. Same prompt the e2e suite uses.
  const composer = page.locator('mvk-chat-shell form.composer input[name="composer"]');
  await composer.fill('Add Sarah Chen (schen@acme.com, Finance) as a custodian on this matter');
  await page.locator('mvk-chat-shell form.composer button[type="submit"]').click();
  console.log('→ prompt sent; waiting for custodian-card …');

  await page.waitForSelector('mvk-chat-shell app-custodian-card', { timeout: 120_000 });
  // Give the widget a moment to settle (Zod-validated render + animations).
  await page.waitForTimeout(1500);
  console.log('→ widget rendered');

  // Capture the chat shell + a slice of the dashboard to its left, so the
  // viewer sees both the chat surface AND a dashboard widget for context.
  // Bounding box pulled from the actual rendered shell.
  const shellBox = await page.locator('mvk-chat-shell').boundingBox();
  if (!shellBox) throw new Error('chat shell has no bounding box (mount failed?)');

  // Capture full viewport to get the dashboard background + the chat shell.
  await page.screenshot({
    path: OUT_PATH,
    fullPage: false,
    clip: undefined, // full viewport — looks more like a real product screenshot
  });
  console.log(`→ saved ${OUT_PATH}`);

  await browser.close();
}

main().catch((err) => {
  console.error('capture failed:', err.message);
  process.exit(1);
});
