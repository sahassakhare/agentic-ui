/**
 * Chat-shell helpers — wrap the `<mvk-chat-shell>` component so specs
 * read like prompts ("send X, expect Y") rather than DOM plumbing.
 *
 * @remarks
 * The chat shell renders user/assistant messages as `.msg.user` /
 * `.msg.assistant` divs inside a `.transcript` container, plus a
 * composer `<form class="composer">` with one `<input>` and one
 * `<button>`. Tool-call results render either as `.msg.tool` text
 * (when `[showToolCalls]` ≠ `'hidden'`) or as `<mvk-widget-container>`
 * children of the assistant bubble.
 */
import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export interface ChatShell {
  readonly composer: Locator;
  readonly send: Locator;
  readonly transcript: Locator;
  /** Send `text` and wait until the message appears in the transcript. */
  ask(text: string): Promise<void>;
  /** Wait until the assistant emits a non-loading message after the last user turn. */
  waitForAssistant(opts?: { timeoutMs?: number }): Promise<Locator>;
  /** Wait for a specific widget selector (custodianCard, productionSummary, etc.) to render. */
  waitForWidget(widgetSelector: string, opts?: { timeoutMs?: number }): Promise<Locator>;
  /** Wait until the routing banner mentions the given specialist id. */
  waitForRoute(specialist: string, opts?: { timeoutMs?: number }): Promise<void>;
  /** Pull the most recent assistant message's text content. */
  lastAssistantText(): Promise<string>;
}

export function chatShell(page: Page): ChatShell {
  const root = page.locator('mvk-chat-shell');
  const composer = root.locator('form.composer input');
  const send = root.locator('form.composer button[type="submit"]');
  const transcript = root.locator('.transcript');

  return {
    composer,
    send,
    transcript,

    async ask(text: string) {
      await composer.fill(text);
      await send.click();
      // Confirm the user bubble landed before yielding control.
      await expect(transcript.locator('.msg.user', { hasText: text }).last()).toBeVisible({
        timeout: 10_000,
      });
    },

    async waitForAssistant({ timeoutMs = 60_000 } = {}) {
      // Loading bubble is "…"; assistant content arrives once the stream completes.
      // Find the LAST .msg.assistant whose text is not just "…".
      const lastAssistant = transcript.locator('.msg.assistant:not(:has-text("…"))').last();
      await expect(lastAssistant).toBeVisible({ timeout: timeoutMs });
      // Stabilise — wait until composer is enabled again (chat finished streaming).
      await expect(composer).toBeEnabled({ timeout: timeoutMs });
      return lastAssistant;
    },

    async waitForWidget(widgetSelector: string, { timeoutMs = 60_000 } = {}) {
      const widget = transcript.locator(widgetSelector).last();
      await expect(widget).toBeVisible({ timeout: timeoutMs });
      return widget;
    },

    async waitForRoute(specialist: string, { timeoutMs = 30_000 } = {}) {
      // Orchestrator's routing banner contains "Routed to **<id>** specialist."
      // Banner only appears on first turn or when the specialist switches.
      // For sticky-routing turns this is best-effort — caller can `.catch()`.
      const banner = transcript.locator(`.msg.assistant:has-text("Routed to")`).last();
      await expect(banner).toContainText(specialist, { timeout: timeoutMs, ignoreCase: true });
    },

    async lastAssistantText() {
      const last = transcript.locator('.msg.assistant').last();
      return (await last.textContent()) ?? '';
    },
  };
}

/**
 * Programmatic check the agent server is configured with a real LLM.
 * Tests skip themselves when the coordinator falls back to the echo
 * placeholder (no `GOOGLE_GENERATIVE_AI_API_KEY` in `.env`).
 */
type RequestLike = {
  readonly request: {
    get(url: string): Promise<{ ok(): boolean; json(): Promise<unknown> }>;
  };
};

export async function isCoordinatorLLMReady(
  ctx: RequestLike,
  serverUrl = process.env['EDIS_SERVER'] ?? 'http://localhost:4311',
): Promise<boolean> {
  try {
    const res = await ctx.request.get(`${serverUrl}/health`);
    if (!res.ok()) return false;
    const body = await res.json() as { coordinator?: string };
    return body.coordinator === 'gemini-orchestrator';
  } catch {
    return false;
  }
}
