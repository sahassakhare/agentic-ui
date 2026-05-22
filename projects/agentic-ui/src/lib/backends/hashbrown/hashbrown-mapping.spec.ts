import { describe, expect, it } from 'vitest';
import type { Frame } from '@hashbrownai/core';
import type { AgenticMessage } from '../../internal';
import { convertMessagesToHashbrown } from './hashbrown-converters';
import { HashbrownFrameMapper } from './hashbrown-frame-mapper';

/** Build an AgenticMessage with sensible defaults. */
function msg(partial: Partial<AgenticMessage> & Pick<AgenticMessage, 'role'>): AgenticMessage {
  return {
    id: partial.id ?? `m-${partial.role}`,
    role: partial.role,
    content: partial.content ?? '',
    toolCalls: partial.toolCalls ?? [],
    widgets: partial.widgets ?? [],
  };
}

describe('convertMessagesToHashbrown', () => {
  it('lifts system messages into the system prompt, not the messages array', () => {
    const { system, messages } = convertMessagesToHashbrown([
      msg({ role: 'system', content: 'You are helpful.' }),
      msg({ role: 'user', content: 'Hi' }),
    ]);
    expect(system).toBe('You are helpful.');
    expect(messages).toEqual([{ role: 'user', content: 'Hi' }]);
  });

  it('concatenates multiple system messages', () => {
    const { system } = convertMessagesToHashbrown([
      msg({ role: 'system', content: 'Rule one.' }),
      msg({ role: 'system', content: 'Rule two.' }),
    ]);
    expect(system).toBe('Rule one.\n\nRule two.');
  });

  it('maps assistant tool calls and emits a tool message for client-side results', () => {
    const { messages } = convertMessagesToHashbrown([
      msg({
        role: 'assistant',
        content: 'Booking…',
        toolCalls: [
          { toolCallId: 'tc1', name: 'bookFlight', args: { from: 'LAX' }, result: { ok: true } },
        ],
      }),
    ]);
    expect(messages[0]).toEqual({
      role: 'assistant',
      content: 'Booking…',
      toolCalls: [
        { index: 0, id: 'tc1', type: 'function', function: { name: 'bookFlight', arguments: JSON.stringify({ from: 'LAX' }) } },
      ],
    });
    // The result becomes a Hashbrown tool message (PromiseSettledResult shape).
    expect(messages[1]).toEqual({
      role: 'tool',
      toolCallId: 'tc1',
      toolName: 'bookFlight',
      content: { status: 'fulfilled', value: { ok: true } },
    });
  });

  it('passes through string tool-call args unchanged', () => {
    const { messages } = convertMessagesToHashbrown([
      msg({ role: 'assistant', toolCalls: [{ toolCallId: 't', name: 'x', args: '{"raw":1}' }] }),
    ]);
    const assistant = messages[0] as { toolCalls: { function: { arguments: string } }[] };
    expect(assistant.toolCalls[0].function.arguments).toBe('{"raw":1}');
  });
});

describe('HashbrownFrameMapper', () => {
  function chunk(content: string): Frame {
    return { type: 'generation-chunk', chunk: { choices: [{ index: 0, delta: { content }, finishReason: null }] } };
  }

  it('maps generation-chunk text into text-delta with a stable messageId', () => {
    const m = new HashbrownFrameMapper('run1');
    const a = m.map(chunk('Hello '));
    const b = m.map(chunk('world'));
    expect(a).toEqual([{ type: 'text-delta', messageId: 'hb-run1', delta: 'Hello ' }]);
    expect(b).toEqual([{ type: 'text-delta', messageId: 'hb-run1', delta: 'world' }]);
  });

  it('ignores generation-start and empty content', () => {
    const m = new HashbrownFrameMapper('run1');
    expect(m.map({ type: 'generation-start' })).toEqual([]);
    expect(m.map(chunk(''))).toEqual([]);
  });

  it('maps generation-error to a run-error event', () => {
    const m = new HashbrownFrameMapper('run1');
    expect(m.map({ type: 'generation-error', error: 'boom' })).toEqual([
      { type: 'run-error', runId: 'run1', error: { code: 'hashbrown_generation_error', message: 'boom' } },
    ]);
  });

  it('opens a tool call once, streams arg deltas, and closes on finish', () => {
    const m = new HashbrownFrameMapper('run1');
    const open = m.map({
      type: 'generation-chunk',
      chunk: { choices: [{ index: 0, delta: { toolCalls: [{ index: 0, id: 'tc9', function: { name: 'bookFlight', arguments: '{"fr' } }] }, finishReason: null }] },
    });
    expect(open).toEqual([
      { type: 'tool-call-start', toolCallId: 'tc9', name: 'bookFlight' },
      { type: 'tool-call-args', toolCallId: 'tc9', delta: '{"fr' },
    ]);

    const more = m.map({
      type: 'generation-chunk',
      chunk: { choices: [{ index: 0, delta: { toolCalls: [{ index: 0, function: { arguments: 'om":"LAX"}' } }] }, finishReason: null }] },
    });
    expect(more).toEqual([{ type: 'tool-call-args', toolCallId: 'tc9', delta: 'om":"LAX"}' }]);

    expect(m.map({ type: 'generation-finish' })).toEqual([{ type: 'tool-call-end', toolCallId: 'tc9' }]);
    // Idempotent: finalize after finish emits nothing.
    expect(m.finalize()).toEqual([]);
  });

  it('finalize() closes tool calls left open by a truncated stream', () => {
    const m = new HashbrownFrameMapper('run1');
    m.map({
      type: 'generation-chunk',
      chunk: { choices: [{ index: 0, delta: { toolCalls: [{ index: 0, id: 'tcX', function: { name: 'f' } }] }, finishReason: null }] },
    });
    expect(m.finalize()).toEqual([{ type: 'tool-call-end', toolCallId: 'tcX' }]);
  });
});
