import { describe, expect, it } from 'vitest';
import { EventType, type BaseEvent } from '@ag-ui/client';
import { extractWidgetRenders, mapAgUiEvent } from './event-mapper';
import type { AgenticEvent } from '../../internal';

type WidgetRenderEvent = Extract<AgenticEvent, { type: 'widget-render' }>;

const RUN_ID = 'r-test';

function ev(props: Record<string, unknown>): BaseEvent {
  return props as unknown as BaseEvent;
}

describe('mapAgUiEvent', () => {
  it('maps RUN_STARTED with threadId + runId', () => {
    const out = mapAgUiEvent(ev({ type: EventType.RUN_STARTED, threadId: 't1' }), RUN_ID);
    expect(out).toEqual({ type: 'run-started', threadId: 't1', runId: RUN_ID });
  });

  it('maps RUN_FINISHED', () => {
    expect(mapAgUiEvent(ev({ type: EventType.RUN_FINISHED }), RUN_ID))
      .toEqual({ type: 'run-finished', runId: RUN_ID });
  });

  it('maps RUN_ERROR with message + code defaults', () => {
    expect(mapAgUiEvent(ev({ type: EventType.RUN_ERROR, message: 'boom', code: 'foo' }), RUN_ID))
      .toEqual({ type: 'run-error', runId: RUN_ID, error: { code: 'foo', message: 'boom' } });
  });

  it('maps RUN_ERROR with sane defaults when fields missing', () => {
    const out = mapAgUiEvent(ev({ type: EventType.RUN_ERROR }), RUN_ID) as Extract<ReturnType<typeof mapAgUiEvent>, { type: 'run-error' }>;
    expect(out!.error.code).toBe('ag_ui_error');
    expect(typeof out!.error.message).toBe('string');
  });

  it('maps TEXT_MESSAGE_CONTENT to text-delta', () => {
    expect(mapAgUiEvent(ev({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'hi' }), RUN_ID))
      .toEqual({ type: 'text-delta', messageId: 'm1', delta: 'hi' });
  });

  it('maps TEXT_MESSAGE_END to text-end', () => {
    expect(mapAgUiEvent(ev({ type: EventType.TEXT_MESSAGE_END, messageId: 'm1' }), RUN_ID))
      .toEqual({ type: 'text-end', messageId: 'm1' });
  });

  it('maps the full TOOL_CALL group', () => {
    expect(mapAgUiEvent(ev({ type: EventType.TOOL_CALL_START, toolCallId: 'tc1', toolCallName: 'add' }), RUN_ID))
      .toEqual({ type: 'tool-call-start', toolCallId: 'tc1', name: 'add' });
    expect(mapAgUiEvent(ev({ type: EventType.TOOL_CALL_ARGS, toolCallId: 'tc1', delta: '{"a"' }), RUN_ID))
      .toEqual({ type: 'tool-call-args', toolCallId: 'tc1', delta: '{"a"' });
    expect(mapAgUiEvent(ev({ type: EventType.TOOL_CALL_END, toolCallId: 'tc1' }), RUN_ID))
      .toEqual({ type: 'tool-call-end', toolCallId: 'tc1' });
  });

  it('parses a JSON tool-call-result content', () => {
    const out = mapAgUiEvent(ev({ type: EventType.TOOL_CALL_RESULT, toolCallId: 'tc1', content: '{"ok":true}' }), RUN_ID);
    expect(out).toEqual({ type: 'tool-call-result', toolCallId: 'tc1', result: { ok: true } });
  });

  it('passes through non-JSON tool-call-result content as a string', () => {
    expect(mapAgUiEvent(ev({ type: EventType.TOOL_CALL_RESULT, toolCallId: 'tc1', content: 'plain' }), RUN_ID))
      .toEqual({ type: 'tool-call-result', toolCallId: 'tc1', result: 'plain' });
  });

  it('returns null for unmapped event types (e.g., STATE_SNAPSHOT)', () => {
    expect(mapAgUiEvent(ev({ type: EventType.STATE_SNAPSHOT, snapshot: {} }), RUN_ID)).toBeNull();
  });
});

describe('extractWidgetRenders (showComponents convention)', () => {
  it('emits a widget-render per component in the result', () => {
    const widgets = extractWidgetRenders(ev({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: 'tc1',
      content: JSON.stringify({
        components: [
          { name: 'flightCard', props: { id: 'BK-1' } },
          { name: 'priceTag', props: { amount: 199 } },
        ],
      }),
    }));
    expect(widgets).toHaveLength(2);
    expect(widgets[0]).toMatchObject({ type: 'widget-render', name: 'flightCard', widgetCallId: 'tc1-0' });
    expect(widgets[1]).toMatchObject({ type: 'widget-render', name: 'priceTag', widgetCallId: 'tc1-1' });
  });

  it('returns [] when result is not a showComponents shape', () => {
    expect(extractWidgetRenders(ev({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: 'tc1',
      content: '{"foo":"bar"}',
    }))).toEqual([]);
  });

  it('returns [] for non-result events', () => {
    expect(extractWidgetRenders(ev({ type: EventType.RUN_STARTED, threadId: 't' }))).toEqual([]);
  });

  it('skips entries with non-string names', () => {
    const widgets = extractWidgetRenders(ev({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: 'tc1',
      content: JSON.stringify({ components: [{ name: 42, props: {} }, { name: 'good', props: {} }] }),
    })) as WidgetRenderEvent[];
    expect(widgets).toHaveLength(1);
    expect(widgets[0]!.name).toBe('good');
  });

  it('defaults props to {} when omitted', () => {
    const widgets = extractWidgetRenders(ev({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: 'tc1',
      content: JSON.stringify({ components: [{ name: 'simple' }] }),
    })) as WidgetRenderEvent[];
    expect(widgets[0]!.props).toEqual({});
  });
});
