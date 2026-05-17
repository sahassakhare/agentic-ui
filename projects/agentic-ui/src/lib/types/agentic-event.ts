export type AgenticEvent =
  | { type: 'run-started'; threadId: string; runId: string }
  | { type: 'run-finished'; runId: string }
  | { type: 'run-error'; runId: string; error: { code: string; message: string } }
  | { type: 'text-delta'; messageId: string; delta: string }
  | { type: 'text-end'; messageId: string }
  | { type: 'tool-call-start'; toolCallId: string; name: string }
  | { type: 'tool-call-args'; toolCallId: string; delta: string }
  | { type: 'tool-call-end'; toolCallId: string }
  | { type: 'tool-call-result'; toolCallId: string; result: unknown }
  | { type: 'widget-render'; widgetCallId: string; name: string; props: unknown }
  // ADR-043 D3 — slot-based agent-directed layout. Carried alongside
  // `widget-render` events on the same stream. Hosts read the active
  // layout via `AgenticChatRef.activeLayout` and mount
  // `<mvk-workspace-layout>` wherever (typically the route's main
  // pane). Backends without layout support never emit this event;
  // existing consumers see no behaviour change.
  | {
      type: 'layout-render';
      layoutName?: string;
      slots: Readonly<Record<string, {
        readonly component: string;
        readonly props?: unknown;
        readonly size?: { readonly default: string; readonly min?: string; readonly max?: string };
        readonly pinned?: boolean;
        readonly open?: 'inline' | 'modal' | 'drawer' | 'overlay';
      }>>;
      responsive?: readonly { readonly belowPx: number; readonly collapse: readonly string[]; readonly drawer: readonly string[] }[];
      data?: Readonly<Record<string, unknown>>;
    }
  | { type: 'ui-action'; actionId: string; op: string; payload: unknown }
  // Capability F5 — long-running operations (additive, per r3 plan §9.5).
  // Backends without LRO support never emit these; they degrade to
  // synchronous tool execution and a console warning at the chat shell.
  | { type: 'operation-started'; opId: string; toolName: string; description: string; estDurationMs?: number }
  | { type: 'operation-progress'; opId: string; pct: number; phase?: string; partialResult?: unknown }
  | { type: 'operation-finished'; opId: string; result: unknown; durationMs: number }
  | { type: 'operation-failed'; opId: string; error: { code: string; message: string } };

export type AgenticEventType = AgenticEvent['type'];
