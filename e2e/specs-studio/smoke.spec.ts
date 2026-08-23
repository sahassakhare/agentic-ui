import { test, expect, type Page } from '@playwright/test';

/**
 * Studio shell + navigation smoke tests. UI-only: they assert the app boots,
 * the primary chrome renders, routing works, the ⌘K palette behaves, the theme
 * toggle flips, and a designer route mounts — all resilient to the catalog
 * backend being unavailable.
 *
 * Requires the app served with `authMode: 'disabled'`: in that mode "sign in"
 * is just choosing a tenant on /login, which signIn() drives.
 */

const TENANT = process.env['STUDIO_TENANT'] ?? 'acme';

/** Ensure an authenticated session (disabled-mode tenant login) and land in-app. */
async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  if (page.url().includes('/login')) {
    await page.locator('#tenant').fill(TENANT);
    await page.getByRole('button', { name: 'Open tenant' }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
  }
}

test.describe('Studio shell', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('boots and renders the shell chrome', async ({ page }) => {
    await expect(page.locator('mat-toolbar.topbar')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Experience Studio home' })).toBeVisible();
    // mat-tab-nav-bar exposes the nav as a tablist with tab links.
    const nav = page.getByRole('tablist', { name: 'Primary' });
    await expect(nav).toBeVisible();
    for (const label of ['Experiences', 'Forms', 'Pages', 'Workflows', 'Decisions']) {
      await expect(nav.getByRole('tab', { name: label, exact: true })).toBeVisible();
    }
  });

  test('navigates between sections via the tab nav', async ({ page }) => {
    await page.getByRole('tab', { name: 'Forms', exact: true }).click();
    await expect(page).toHaveURL(/\/forms$/);
    await page.getByRole('tab', { name: 'Pages', exact: true }).click();
    await expect(page).toHaveURL(/\/pages$/);
  });

  test('theme toggle flips the document theme', async ({ page }) => {
    const root = page.locator('html');
    const before = await root.getAttribute('data-theme');
    await page.getByRole('button', { name: /Switch to (light|dark) theme/ }).click();
    await expect.poll(async () => root.getAttribute('data-theme')).not.toBe(before);
  });
});

test.describe('Command palette (⌘K)', () => {
  test('opens on shortcut, filters, and closes on Escape', async ({ page }) => {
    await signIn(page);
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+KeyK`);

    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible();

    await page.getByPlaceholder(/Jump to a section or capability/).fill('forms');
    await expect(dialog.getByRole('option').first()).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});

test.describe('Designers mount', () => {
  test('Forms list route renders its heading', async ({ page }) => {
    await signIn(page);
    await page.getByRole('tab', { name: 'Forms', exact: true }).click();
    await expect(page).toHaveURL(/\/forms$/);
    // The section heading renders regardless of whether the catalog returns data.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
