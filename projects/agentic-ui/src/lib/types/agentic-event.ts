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
  | { type: 'ui-action'; actionId: string; op: string; payload: unknown };

export type AgenticEventType = AgenticEvent['type'];
