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
  | { type: 'ui-action'; actionId: string; op: string; payload: unknown }
  // Capability F5 — long-running operations (additive, per r3 plan §9.5).
  // Backends without LRO support never emit these; they degrade to
  // synchronous tool execution and a console warning at the chat shell.
  | { type: 'operation-started'; opId: string; toolName: string; description: string; estDurationMs?: number }
  | { type: 'operation-progress'; opId: string; pct: number; phase?: string; partialResult?: unknown }
  | { type: 'operation-finished'; opId: string; result: unknown; durationMs: number }
  | { type: 'operation-failed'; opId: string; error: { code: string; message: string } };

export type AgenticEventType = AgenticEvent['type'];
