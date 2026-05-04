/**
 * Capture multiple eDiscovery screenshots for the deck.
 *
 * Produces:
 *   docs/assets/deck-dashboard.png        — Matter snapshot full dashboard
 *   docs/assets/deck-persona-menu.png     — Persona dropdown showing live
 *                                            tool counts per role (no LLM)
 *   docs/assets/deck-audit-trail.png      — Audit Trail page (chain of
 *                                            custody, integrity badge)
 *   docs/assets/deck-productions.png      — Productions master-detail view
 *
 * All four are LLM-free captures — they don't burn Gemini quota. The
 * agentic-ui-in-action.png hero (which DOES drive a chat turn) lives in
 * scripts/capture-readme-screenshot.mjs.
 *
 * Run:
 *   node scripts/capture-deck-screenshots.mjs
 *
 * Prereqs (5 services on the usual ports):
 *   :4300 demo-ediscovery-shell
 *   :4302 demo-ediscovery-review
 *   :4303 demo-ediscovery-production
 *   :4304 demo-ediscovery-search
 *   :4311 demo-ediscovery-server
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.EDIS_BASE_URL ?? 'http://localhost:4300';
const OUT_DIR = 'docs/assets';

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 2,
  });

  const captures = [
    {
      name: 'deck-dashboard.png',
      label: 'Matter snapshot dashboard',
      route: '/',
      after: async (page) => {
        await page.waitForSelector('mvk-kpi-card', { timeout: 15_000 });
        await page.waitForTimeout(800);
      },
    },
    {
      name: 'deck-persona-menu.png',
      label: 'Persona dropdown (live tool-count badges)',
      route: '/',
      after: async (page) => {
        await page.waitForSelector('app-header .persona-btn', { timeout: 15_000 });
        await page.locator('app-header .persona-btn').click();
        await page.waitForSelector('app-header .persona-menu', { timeout: 5_000 });
        await page.waitForTimeout(500);
      },
    },
    {
      name: 'deck-audit-trail.png',
      label: 'Audit Trail page (chain integrity badge)',
      route: '/audit',
      after: async (page) => {
        await page.waitForSelector('app-audit', { timeout: 15_000 });
        await page.waitForTimeout(800);
      },
    },
    {
      name: 'deck-productions.png',
      label: 'Productions page (master-detail layout)',
      route: '/productions',
      after: async (page) => {
        await page.waitForSelector('app-productions', { timeout: 15_000 });
        await page.waitForTimeout(800);
      },
    },
  ];

  for (const { name, label, route, after } of captures) {
    const page = await ctx.newPage();
    console.log(`→ capturing ${label}`);
    await page.goto(`${BASE}${route}`);
    await page.waitForSelector('app-sidebar', { timeout: 15_000 });
    await after(page);
    await page.screenshot({ path: `${OUT_DIR}/${name}`, fullPage: false });
    console.log(`  saved ${OUT_DIR}/${name}`);
    await page.close();
  }

  await browser.close();
}

main().catch((err) => {
  console.error('capture failed:', err.message);
  process.exit(1);
});
