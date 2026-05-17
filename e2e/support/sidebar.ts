/**
 * Sidebar helpers — the live "capabilities loaded" footer reads
 * `ToolRegistry.signal()` and `CapabilityRegistry.signal()` directly,
 * so it's the cheapest way to assert that federation finished
 * loading before a spec sends its first prompt.
 */
import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export interface Sidebar {
  readonly root: Locator;
  /** Number of tools the agent currently sees (post-scope-policy). */
  toolCount(): Promise<number>;
  /** Number of federated remotes registered in `CapabilityRegistry`. */
  remoteCount(): Promise<number>;
  /** Wait until at least `n` remotes are registered. */
  waitForRemotes(n: number, opts?: { timeoutMs?: number }): Promise<void>;
}

export function sidebar(page: Page): Sidebar {
  const root = page.locator('app-sidebar .rail');

  async function readNumber(label: string): Promise<number> {
    const el = root.locator('footer .rows div', { hasText: label });
    const txt = (await el.locator('strong').textContent()) ?? '';
    return Number(txt.trim()) || 0;
  }

  return {
    root,
    toolCount: () => readNumber('tools'),
    remoteCount: () => readNumber('remotes'),
    async waitForRemotes(n: number, { timeoutMs = 60_000 } = {}) {
      await expect(async () => {
        const c = await readNumber('remotes');
        if (c < n) throw new Error(`expected ≥${n} remotes, got ${c}`);
      }).toPass({ timeout: timeoutMs, intervals: [500, 1_000, 2_000] });
    },
  };
}
