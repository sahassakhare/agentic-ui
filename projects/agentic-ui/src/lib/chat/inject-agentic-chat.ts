import { computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { ToolRegistry } from '../registries/tool-registry';
import { ComponentRegistry } from '../registries/component-registry';
import { BackendRegistry } from '../registries/backend-registry';
import { AGENTIC_TELEMETRY_SINK } from '../telemetry/telemetry-sink';
import type { AgenticMessage } from '../types/agentic-message';
import { randomId } from './message-utils';
import { runUntilSettled } from './run-orchestrator';
import { TOOL_FILTER } from './tool-filter';

export interface AgenticChatOptions {
  readonly maxLocalTurns?: number;
  /** Override the active backend for this chat instance. */
  readonly backendId?: string;
}

export interface AgenticChatRef {
  /** Reactive list of messages — drives the chat transcript UI. */
  readonly value: Signal<readonly AgenticMessage[]>;
  readonly isLoading: Signal<boolean>;
  readonly error: Signal<Error | undefined>;
  /** Append a user message and trigger a new run. */
  sendMessage(content: string): void;
  /** Abort any in-flight run and clear state. */
  reset(): void;
  /** Abort any in-flight run; keep transcript. */
  stop(): void;
}

/**
 * Returns a controller for an agentic chat session. Mirrors flights42's
 * `agUiResource()` but is backend-agnostic — the active backend is resolved
 * from `BackendRegistry`.
 *
 * Must be called inside an Angular injection context (component constructor,
 * `inject()` field initializer, route resolver, etc.).
 */
export function injectAgenticChat(options: AgenticChatOptions = {}): AgenticChatRef {
  const tools = inject(ToolRegistry);
  const widgets = inject(ComponentRegistry);
  const backends = inject(BackendRegistry);
  const telemetry = inject(AGENTIC_TELEMETRY_SINK);
  const toolFilter = inject(TOOL_FILTER);

  const maxLocalTurns = options.maxLocalTurns ?? 10;
  const messages: WritableSignal<readonly AgenticMessage[]> = signal([]);
  const isLoading = signal(false);
  const lastError = signal<Error | undefined>(undefined);

  let abortController: AbortController | undefined;
  const threadId = randomId('thread');

  const sendMessage = (content: string): void => {
    const trimmed = content.trim();
    if (!trimmed) return;

    const userMessage: AgenticMessage = {
      id: randomId('msg'),
      role: 'user',
      content: trimmed,
      toolCalls: [],
      widgets: [],
    };
    messages.update((cur) => [...cur, userMessage]);

    const def = options.backendId
      ? backends.list().find((b) => b.id === options.backendId)
      : backends.active();
    if (!def) {
      lastError.set(new Error('No backend registered. Call provideAgenticBackend(...) before sendMessage.'));
      return;
    }
    const backend = options.backendId ? def.factory() : backends.resolveActive();
    if (!backend) {
      lastError.set(new Error(`Backend "${def.id}" failed to resolve.`));
      return;
    }

    abortController?.abort();
    abortController = new AbortController();
    isLoading.set(true);
    lastError.set(undefined);

    const runId = randomId('run');

    // Run the configured tool filter so the backend (and the LLM behind
    // it) only sees a relevant subset. Default is the identity filter,
    // so this is a no-op until a consumer calls provideToolFilter(...).
    const filteredTools = toolFilter({
      messages: messages().map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
      })),
      tools: tools.list(),
    });

    runUntilSettled({
      backend,
      threadId,
      runId,
      initialMessages: messages(),
      tools: filteredTools,
      widgets: widgets.list(),
      messageStream: messages,
      maxLocalTurns,
      signal: abortController.signal,
      telemetry,
    })
      .catch((err) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          lastError.set(err instanceof Error ? err : new Error(String(err)));
        }
      })
      .finally(() => {
        isLoading.set(false);
      });
  };

  const reset = (): void => {
    abortController?.abort();
    abortController = undefined;
    messages.set([]);
    isLoading.set(false);
    lastError.set(undefined);
  };

  const stop = (): void => {
    abortController?.abort();
    isLoading.set(false);
  };

  return {
    value: computed(() => messages()),
    isLoading,
    error: lastError,
    sendMessage,
    reset,
    stop,
  };
}
