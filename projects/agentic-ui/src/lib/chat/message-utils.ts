import type { AgenticMessage, AgenticToolCall, AgenticWidgetInstance } from '../types/agentic-message';

export function emptyMessage(id: string, role: AgenticMessage['role']): AgenticMessage {
  return { id, role, content: '', toolCalls: [], widgets: [] };
}

export function appendDelta(messages: readonly AgenticMessage[], messageId: string, delta: string, role: AgenticMessage['role'] = 'assistant'): readonly AgenticMessage[] {
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx === -1) {
    return [...messages, { ...emptyMessage(messageId, role), content: delta }];
  }
  const target = messages[idx]!;
  return [
    ...messages.slice(0, idx),
    { ...target, content: target.content + delta },
    ...messages.slice(idx + 1),
  ];
}

export function attachToolCall(messages: readonly AgenticMessage[], messageId: string, toolCall: AgenticToolCall): readonly AgenticMessage[] {
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx === -1) {
    return [...messages, { ...emptyMessage(messageId, 'assistant'), toolCalls: [toolCall] }];
  }
  const target = messages[idx]!;
  const filtered = target.toolCalls.filter((tc) => tc.toolCallId !== toolCall.toolCallId);
  return [
    ...messages.slice(0, idx),
    { ...target, toolCalls: [...filtered, toolCall] },
    ...messages.slice(idx + 1),
  ];
}

export function attachWidget(messages: readonly AgenticMessage[], messageId: string, widget: AgenticWidgetInstance): readonly AgenticMessage[] {
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx === -1) {
    return [...messages, { ...emptyMessage(messageId, 'assistant'), widgets: [widget] }];
  }
  const target = messages[idx]!;
  return [
    ...messages.slice(0, idx),
    { ...target, widgets: [...target.widgets, widget] },
    ...messages.slice(idx + 1),
  ];
}

export function appendErrorMessage(messages: readonly AgenticMessage[], errorText: string): readonly AgenticMessage[] {
  return [
    ...messages,
    { id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role: 'system', content: `Error: ${errorText}`, toolCalls: [], widgets: [] },
  ];
}

export function randomId(prefix = ''): string {
  const rand = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  return prefix ? `${prefix}-${rand}` : rand;
}
