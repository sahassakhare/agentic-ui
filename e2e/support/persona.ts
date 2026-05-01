/**
 * Persona-menu helpers for the eDiscovery shell header.
 *
 * The header renders one `.persona-btn` (avatar + active label) which
 * toggles a `.persona-menu` containing one `.menu-item` per persona.
 * Each menu-item shows a `.tool-count` badge (e.g. "8 / 17") that
 * reflects the live `RegistryBase.setScopePolicy` view per role.
 */
import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export type Persona = 'Lead Counsel' | 'Associate' | 'Paralegal' | 'Lit-Support' | 'Vendor Reviewer';

export interface PersonaMenu {
  readonly toggle: Locator;
  readonly menu: Locator;
  open(): Promise<void>;
  /** Click a persona by its label. Closes the menu. */
  select(label: Persona): Promise<void>;
  /** Read the "X / N" tool-count badge for `label` (menu must be open). */
  toolCountFor(label: Persona): Promise<{ allowed: number; total: number }>;
  /** The active persona's label currently shown next to the avatar. */
  active(): Promise<string>;
}

export function personaMenu(page: Page): PersonaMenu {
  const toggle = page.locator('app-header .persona-btn');
  const menu = page.locator('app-header .persona-menu');

  return {
    toggle,
    menu,

    async open() {
      if (await menu.isVisible().catch(() => false)) return;
      await toggle.click();
      await expect(menu).toBeVisible({ timeout: 5_000 });
    },

    async select(label: Persona) {
      await this.open();
      const item = menu.locator('.menu-item', { hasText: label }).first();
      await item.click();
      await expect(menu).not.toBeVisible({ timeout: 5_000 });
    },

    async toolCountFor(label: Persona) {
      await this.open();
      const item = menu.locator('.menu-item', { hasText: label }).first();
      const text = (await item.locator('.tool-count').textContent()) ?? '';
      const m = text.match(/(\d+)\s*\/\s*(\d+)/);
      if (!m) throw new Error(`Couldn't parse tool count for ${label}: "${text}"`);
      return { allowed: Number(m[1]), total: Number(m[2]) };
    },

    async active() {
      return (await toggle.locator('.persona-label').textContent())?.trim() ?? '';
    },
  };
}
