import { effect, EnvironmentInjector, runInInjectionContext, signal } from '@angular/core';
import { injectAgenticChat, type AgenticMessage } from '@maverick/agentic-ui';

/**
 * One-shot, headless LLM call (plan R4 -- "no-chat, but LLM
 * interaction"). Runs the same backend / tools / widget registry
 * the chat shell uses, without mounting a chat transcript: send a
 * single prompt, await all tool calls + widget renders to settle,
 * return the structured result.
 *
 * Used by:
 *   - the Cmd+K command palette (default caller; navigates on
 *     route-aware tool results, otherwise mounts widgets in the
 *     palette's own primary slot),
 *   - future dashboard "smart action" buttons (templated prompt),
 *   - inline NL inputs that need typed args (parameter-extractor
 *     preset).
 *
 * The chat shell stays the canonical conversational surface; this
 * helper proves the registry is surface-independent.
 *
 * **Implementation note** -- the first version of this helper had
 * a settle-detection race (the effect's first fire occasionally
 * resolved with `loading=false` before sendMessage had flipped it
 * to `true`) and a system-prompt prefix that confused Gemini's
 * tool picking. Both fixed in 2026-05-11: prompt goes through
 * untouched, settle gated on hasStarted && !loading.
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
  /** The natural-language input. Capped at 500 chars to keep
   *  prompts small and costs predictable. */
  readonly prompt: string;
  /** Maximum wall-clock to wait for the LLM to settle. */
  readonly timeoutMs?: number;
  /** Optional `AbortSignal` from a UI-level cancel button. */
  readonly signal?: AbortSignal;
}

const MAX_PROMPT_LEN = 500;
const DEFAULT_TIMEOUT_MS = 25_000;

/**
 * Run a one-shot headless prompt. MUST be called inside an
 * injection context (use `runHeadlessIn(env, ...)` from non-Angular
 * callers).
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

  return new Promise<HeadlessRunResult>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopFn: (() => void) | undefined;
    let finished = false;
    /** Did we observe isLoading flip to true? Settle is only
     *  legitimate after the run has demonstrably started. */
    const hasStarted = signal(false);

    const finish = (result: HeadlessRunResult): void => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      stopFn?.();
      resolve(result);
    };

    const onAbort = (): void => {
      chat.stop();
      finish({
        markdown: '', widgets: [], toolCalls: [],
        errored: true, error: 'aborted',
      });
    };

    if (opts.signal) {
      if (opts.signal.aborted) { onAbort(); return; }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }

    timer = setTimeout(() => {
      if (!finished) {
        chat.stop();
        reject(new Error(`headless run timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    // Watch the chat state. Settle only AFTER we've seen
    // isLoading flip to true (i.e. the run actually started) and
    // then back to false (i.e. the run actually finished). Avoids
    // the original race where the effect's first fire saw
    // `loading=false, messages=[]` and immediately resolved with
    // an empty result.
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
      if (loading) {
        hasStarted.set(true);
        return;
      }
      if (hasStarted() && !loading) {
        finish(projectResult(messages));
      }
    });
    stopFn = (): void => ref.destroy();

    // Send AFTER the effect is registered so the loading flip is
    // captured by hasStarted on the very first effect tick.
    chat.sendMessage(prompt);
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
