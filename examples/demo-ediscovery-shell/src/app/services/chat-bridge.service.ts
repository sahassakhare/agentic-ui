import { Injectable, signal } from '@angular/core';
import type { ChatShellComponent } from '@maverick/agentic-ui';

/**
 * Tiny app-root bridge that lets non-chat surfaces (the Cmd+K
 * palette, dashboard smart-buttons, inline NL inputs) send messages
 * through the SAME chat-shell instance the user already sees in the
 * right rail.
 *
 * Why not a separate headless `injectAgenticChat()`? The first
 * attempt at the Cmd+K path created an independent chat thread via
 * `injectAgenticChat()`. It works in theory but fragile in practice:
 * a separate thread duplicates state, the system-prefix wrapper
 * confused the LLM's tool-picking, settle-detection had subtle
 * signal-timing races, and the operator got no UI feedback while
 * the agent ran. Reusing the rail's chat shell is plainer and Just
 * Works -- one backend, one transcript, one auditable thread.
 *
 * Lifecycle:
 *   - ChatRailComponent calls `register(shellRef)` on view-init.
 *   - CommandPalette / smart-buttons call `send(text)` which
 *     opens the rail if collapsed and forwards to `sendMessage()`.
 *   - On teardown the rail calls `register(null)`.
 *
 * The `isReady` signal lets callers gate UI ("Run" button disabled
 * until the rail mounts).
 */
@Injectable({ providedIn: 'root' })
export class ChatBridgeService {
  private shell: ChatShellComponent | null = null;
  readonly isReady = signal<boolean>(false);

  /** Called by ChatRailComponent on init / destroy. */
  register(shell: ChatShellComponent | null): void {
    this.shell = shell;
    this.isReady.set(shell !== null);
  }

  /** Optional opener; the rail toggles itself but the palette
   *  wants to ensure it's visible before sending. */
  private rawOpen: (() => void) | null = null;

  registerOpener(open: (() => void) | null): void {
    this.rawOpen = open;
  }

  /**
   * Send a prompt through the rail's chat. Returns `true` if
   * dispatched, `false` if the rail isn't mounted yet. Caller can
   * inspect the chat transcript for results; the chat shell renders
   * the response (text + tool calls + widget mounts) directly --
   * we don't await anything here on purpose, that's the chat's job.
   */
  send(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed || !this.shell) return false;
    // Make sure the rail is expanded so the operator sees the
    // streaming reply + tool result. Quietly noop if no opener.
    this.rawOpen?.();
    this.shell.sendMessage(trimmed);
    return true;
  }
}
