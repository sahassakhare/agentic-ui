import { effect, EnvironmentInjector, runInInjectionContext, signal } from '@angular/core';
import { injectAgenticChat, type AgenticMessage } from '@maverick/agentic-ui';

/**
 * One-shot, headless LLM call (plan R4 — "no-chat, but LLM
 * interaction"). Runs the same backend / tools / widget registry the
 * chat shell uses, but without mounting the chat UI: send a single
 * prompt, await all tool calls + widget renders to settle, return
 * the structured result.
 *
 * Used by:
 *   - the Cmd+K command palette (action-router preset),
 *   - dashboard "smart action" buttons (templated prompt),
 *   - inline NL inputs that need typed args (parameter-extractor
 *     preset).
 *
 * The chat shell stays the canonical conversational surface; this
 * helper proves the registry is surface-independent.
 */
export interface HeadlessRunResult {
  /** Composite text output (markdown deltas concatenated). */
  readonly markdown: string;
  /** Widgets the LLM emitted via tool results, in order. */
  readonly widgets: ReadonlyArray<{ name: string; props: unknown }>;
  /** Tool calls that fired, in order. Empty if the LLM only
   *  conversed and didn't pick a tool. */
  readonly toolCalls: ReadonlyArray<{ name: string; args: unknown; result?: unknown }>;
  /** True if the run hit an error. `error` carries the message. */
  readonly errored: boolean;
  readonly error: string | null;
}

export interface HeadlessRunOptions {
  /** The natural-language input. Capped at 500 chars to keep prompts
   *  small and costs predictable. */
  readonly prompt: string;
  /** Optional system prompt override. Defaults to the action-router
   *  preset which biases the LLM toward picking exactly one tool. */
  readonly system?: string;
  /** Maximum wall-clock to wait for the LLM to settle (default 25s). */
  readonly timeoutMs?: number;
  /** Optional `AbortSignal` from a UI-level cancel button. */
  readonly signal?: AbortSignal;
}

const DEFAULT_SYSTEM = `You are an action-router. Read the user's
single request and pick exactly one tool to satisfy it. Fill the
tool's arguments from the request. Do not converse — return the
tool result and a single short sentence summarising what you did.
If no tool fits, say so plainly in one sentence.`;

const MAX_PROMPT_LEN = 500;
const DEFAULT_TIMEOUT_MS = 25_000;

/**
 * Run a one-shot headless prompt. MUST be called inside an injection
 * context (use `runInInjectionContext(env, () => runHeadless(...))`
 * from a non-Angular caller).
 *
 * @returns a promise that resolves once the run settles (no more
 * pending tool calls). Rejects on timeout or backend error.
 */
export function runHeadless(opts: HeadlessRunOptions): Promise<HeadlessRunResult> {
  const prompt = opts.prompt.slice(0, MAX_PROMPT_LEN).trim();
  if (!prompt) {
    return Promise.resolve({
      markdown: '', widgets: [], toolCalls: [],
      errored: true, error: 'empty prompt',
    });
  }

  const chat = injectAgenticChat();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // The chat layer doesn't expose a per-call system prompt seam, so
  // we prefix the system instruction onto the user content. Backends
  // see one user message; the bias still lands. Adopters who want a
  // dedicated system message provide it at the backend layer.
  const systemPrefix = opts.system ?? DEFAULT_SYSTEM;
  chat.sendMessage(`[Mode: action-router]\n${systemPrefix}\n\n[Request]\n${prompt}`);

  return new Promise<HeadlessRunResult>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopFn: (() => void) | undefined;
    let aborted = false;

    const finish = (result: HeadlessRunResult) => {
      if (timer) clearTimeout(timer);
      stopFn?.();
      resolve(result);
    };

    const abort = () => {
      aborted = true;
      chat.stop();
      finish({
        markdown: '', widgets: [], toolCalls: [],
        errored: true, error: 'aborted',
      });
    };

    if (opts.signal) {
      if (opts.signal.aborted) { abort(); return; }
      opts.signal.addEventListener('abort', abort, { once: true });
    }

    timer = setTimeout(() => {
      if (!aborted) {
        chat.stop();
        reject(new Error(`headless run timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    // Watch the chat state. Settle when it stops loading AND there
    // are messages with tool results / widgets / final markdown.
    const settled = signal(false);
    const ref = effect(() => {
      const loading = chat.isLoading();
      const err = chat.error();
      const messages = chat.value();
      if (err) {
        finish({
          markdown: '', widgets: [], toolCalls: [],
          errored: true, error: err.message,
        });
        return;
      }
      if (!loading && messages.length > 0 && !settled()) {
        settled.set(true);
        // Last assistant message is the one we care about.
        finish(projectResult(messages));
      }
    });
    stopFn = () => ref.destroy();
  });
}

/**
 * Convenience wrapper that handles the injection-context boilerplate
 * for non-component callers (e.g. command-palette button handlers).
 */
export function runHeadlessIn(
  env: EnvironmentInjector,
  opts: HeadlessRunOptions,
): Promise<HeadlessRunResult> {
  return runInInjectionContext(env, () => runHeadless(opts));
}

function projectResult(messages: readonly AgenticMessage[]): HeadlessRunResult {
  // Collect every assistant message after the user's prompt — the
  // orchestrator may emit several when multiple tool calls fire.
  const assistantMsgs = messages.filter((m) => m.role === 'assistant');
  const widgets: { name: string; props: unknown }[] = [];
  const toolCalls: { name: string; args: unknown; result?: unknown }[] = [];
  let markdown = '';

  for (const m of assistantMsgs) {
    if (typeof m.content === 'string' && m.content.trim()) {
      markdown += (markdown ? '\n\n' : '') + m.content;
    }
    for (const tc of m.toolCalls ?? []) {
      const entry: { name: string; args: unknown; result?: unknown } = { name: tc.name, args: tc.args };
      if (tc.result !== undefined) entry.result = tc.result;
      toolCalls.push(entry);
    }
    for (const w of m.widgets ?? []) {
      widgets.push({ name: w.name, props: w.props });
    }
  }

  return { markdown, widgets, toolCalls, errored: false, error: null };
}
