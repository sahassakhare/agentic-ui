export type AgenticMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AgenticToolCall {
  toolCallId: string;
  name: string;
  args: unknown;
  result?: unknown;
  error?: { code: string; message: string };
}

export interface AgenticWidgetInstance {
  widgetCallId: string;
  name: string;
  props: unknown;
}

export interface AgenticMessage {
  id: string;
  role: AgenticMessageRole;
  content: string;
  toolCalls: readonly AgenticToolCall[];
  widgets: readonly AgenticWidgetInstance[];
}
