import { computed, inject, signal, Signal, WritableSignal } from '@angular/core';
import { ToolRegistry } from '../registries/tool-registry';
import { ComponentRegistry } from '../registries/component-registry';
import { BackendRegistry } from '../registries/backend-registry';
import { ApprovalRegistry } from '../registries/approval-registry';
import { OperationRegistry } from '../registries/operation-registry';
import { AGENTIC_TELEMETRY_SINK } from '../telemetry/telemetry-sink';
import type { AgenticMessage, MessageContent } from '../types/agentic-message';
import type { LayoutRenderState } from '../layout/types';
import { AGENTIC_ACTIVE_PERSONA } from './active-persona';
import { AGENTIC_RUN_STATE_PROVIDER } from './run-state-provider';
import { randomId } from './message-utils';
import { runUntilSettled } from './run-orchestrator';
import { TOOL_FILTER } from './tool-filter';
import { AgentContextProvider } from '../layout/agent-context/agent-context-provider';

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
  /**
   * Latest agent-emitted workspace layout (ADR-043 D3) or `null` when
   * no layout has been emitted or `clearLayout()` was called. Hosts
   * read this signal and mount `<mvk-workspace-layout>` wherever
   * (typically the route's main pane). Backends that don't emit
   * `layout-render` events leave this at `null` — full back-compat
   * with the existing chat-only flow.
   */
  readonly activeLayout: Signal<LayoutRenderState | null>;
  /** Clear `activeLayout` back to `null`. Useful on route change. */
  clearLayout(): void;
  /**
   * Append a user message and trigger a new run.
   *
   * - `string` — the legacy single-part shape (text only).
   * - `MessageContent[]` — multi-modal (Capability F6); requires the
   *   active backend to advertise `multiModal: true`. When the backend
   *   does NOT advertise the capability, the chat shell logs a console
   *   warning, emits a telemetry event, and degrades to a text-only
   *   fallback (filenames + alt text concatenated into a single
   *   `text` part).
   */
  sendMessage(content: string | readonly MessageContent[]): void;
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
  const approvalRegistry = inject(ApprovalRegistry);
  const operationRegistry = inject(OperationRegistry);
  const activePersona = inject(AGENTIC_ACTIVE_PERSONA);
  const stateProvider = inject(AGENTIC_RUN_STATE_PROVIDER);
  // ADR-046 D5 / PR1b — when provideAgentContext is wired, every chat
  // turn gets a synthetic system message describing the live UI state
  // (route, persona, resolved layout). Optional inject so hosts that
  // skip provideAgentContext continue to see zero overhead.
  const agentContext = inject(AgentContextProvider, { optional: true });

  const maxLocalTurns = options.maxLocalTurns ?? 10;
  const messages: WritableSignal<readonly AgenticMessage[]> = signal([]);
  const isLoading = signal(false);
  const lastError = signal<Error | undefined>(undefined);
  // ADR-043 D3 — latest agent-emitted workspace layout. Stays null when
  // the backend never emits `layout-render` events (full back-compat).
  const activeLayout: WritableSignal<LayoutRenderState | null> = signal(null);

  let abortController: AbortController | undefined;
  const threadId = randomId('thread');

  const sendMessage = (content: string | readonly MessageContent[]): void => {
    // Resolve to the wire shape that lands on `AgenticMessage.content`.
    // Multi-modal arrays are kept as-is when the active backend advertises
    // the capability; otherwise a text-only fallback is synthesised from
    // the visible parts (file names + alt text + raw text).
    let resolvedContent: AgenticMessage['content'];
    if (typeof content === 'string') {
      const trimmed = content.trim();
      if (!trimmed) return;
      resolvedContent = trimmed;
    } else {
      if (content.length === 0) return;
      resolvedContent = content;
    }

    const def = options.backendId
      ? backends.list().find((b) => b.id === options.backendId)
      : backends.active();
    const supportsMultiModal = def?.capabilities.multiModal === true;
    if (Array.isArray(resolvedContent) && !supportsMultiModal) {
      const fallback = textOnlyFallback(resolvedContent);
      telemetry.emit('agentic.run.start', {
        'agentic.multimodal.fallback': true,
        'agentic.backend.id': def?.id ?? '(none)',
      });
      // eslint-disable-next-line no-console
      console.warn(
        `[agentic-ui] Backend ${JSON.stringify(def?.id ?? '(none)')} does not advertise ` +
        `multiModal capability; multi-part content was concatenated to text-only fallback.`,
      );
      resolvedContent = fallback;
    }

    const userMessage: AgenticMessage = {
      id: randomId('msg'),
      role: 'user',
      content: resolvedContent,
      toolCalls: [],
      widgets: [],
    };
    messages.update((cur) => [...cur, userMessage]);
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

    // ADR-046 D5 / PR1b — build the per-turn agent-context block ONCE
    // (compose reads live signals at this moment). Passed to the
    // orchestrator as `systemContext`, NOT prepended to messages —
    // the orchestrator splices it into the wire-level
    // `AgenticRunInput.messages` for the backend but keeps it out of
    // `messageStream`, so the rendered transcript stays clean and
    // re-runs don't stack copies of the context in the UI.
    const systemContext = agentContext?.compose() ?? '';

    runUntilSettled({
      backend,
      threadId,
      runId,
      initialMessages: messages(),
      systemContext,
      tools: filteredTools,
      widgets: widgets.list(),
      messageStream: messages,
      layoutStream: activeLayout,
      maxLocalTurns,
      signal: abortController.signal,
      telemetry,
      approvalRegistry,
      activePersona,
      operationRegistry,
      stateProvider,
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
    activeLayout.set(null);
  };

  const clearLayout = (): void => {
    activeLayout.set(null);
  };

  const stop = (): void => {
    abortController?.abort();
    isLoading.set(false);
  };

  return {
    value: computed(() => messages()),
    isLoading,
    error: lastError,
    activeLayout,
    clearLayout,
    sendMessage,
    reset,
    stop,
  };
}

/**
 * Synthesize a single text-only fallback string from a multi-modal
 * `MessageContent[]` payload (Capability F6 graceful degradation).
 *
 * Concatenates text parts verbatim, includes alt text for images
 * (so the LLM at least knows there was an image), and renders file
 * parts as `[file: <filename>]` markers. Used when the active
 * backend does not advertise `multiModal: true`.
 */
function textOnlyFallback(parts: readonly MessageContent[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (p.kind === 'text') {
      out.push(p.text);
    } else if (p.kind === 'image') {
      out.push(`[image${p.alt ? `: ${p.alt}` : ''} (${p.mimeType})]`);
    } else if (p.kind === 'file') {
      out.push(`[file: ${p.filename}${p.sizeBytes ? ` · ${formatSize(p.sizeBytes)}` : ''}]`);
    }
  }
  return out.join('\n').trim();
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '?';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
