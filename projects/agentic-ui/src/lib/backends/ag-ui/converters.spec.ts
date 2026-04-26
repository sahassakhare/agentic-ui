import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { convertMessagesToAgUi, convertToolsToAgUi } from './converters';
import { agenticTool } from '../../factories/agentic-tool';
import type { AgenticMessage, ToolDef } from '../../types';

describe('convertMessagesToAgUi', () => {
  it('passes user messages straight through', () => {
    const out = convertMessagesToAgUi([
      { id: 'u1', role: 'user', content: 'hello', toolCalls: [], widgets: [] },
    ]);
    expect(out).toEqual([{ id: 'u1', role: 'user', content: 'hello' }]);
  });

  it('omits empty assistant content but keeps tool calls', () => {
    const msg: AgenticMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      toolCalls: [
        { toolCallId: 'tc1', name: 'bookFlight', args: { from: 'LAX' } },
      ],
      widgets: [],
    };
    const out = convertMessagesToAgUi([msg]);
    const assistant = out[0]! as { content?: string; toolCalls?: { id: string }[] };
    expect(assistant.content).toBeUndefined();
    expect(assistant.toolCalls).toHaveLength(1);
    expect(assistant.toolCalls![0]!.id).toBe('tc1');
  });

  it('serializes tool-call args as JSON when args is an object', () => {
    const msg: AgenticMessage = {
      id: 'm1',
      role: 'assistant',
      content: 'sure',
      toolCalls: [{ toolCallId: 'tc1', name: 'add', args: { a: 1, b: 2 } }],
      widgets: [],
    };
    const out = convertMessagesToAgUi([msg]);
    const assistant = out[0]! as { toolCalls?: { function: { arguments: string } }[] };
    expect(assistant.toolCalls![0]!.function.arguments).toBe('{"a":1,"b":2}');
  });

  it('passes through string args verbatim (already-serialized streams)', () => {
    const msg: AgenticMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      toolCalls: [{ toolCallId: 'tc1', name: 'add', args: '{"a":1}' }],
      widgets: [],
    };
    const out = convertMessagesToAgUi([msg]);
    const assistant = out[0]! as { toolCalls?: { function: { arguments: string } }[] };
    expect(assistant.toolCalls![0]!.function.arguments).toBe('{"a":1}');
  });

  it('emits a tool message after the assistant when a tool call has a result', () => {
    const msg: AgenticMessage = {
      id: 'm1',
      role: 'assistant',
      content: '',
      toolCalls: [{
        toolCallId: 'tc1',
        name: 'add',
        args: { a: 1, b: 2 },
        result: { sum: 3 },
      }],
      widgets: [],
    };
    const out = convertMessagesToAgUi([msg]);
    expect(out).toHaveLength(2);
    expect(out[0]!.role).toBe('assistant');
    const toolMsg = out[1]! as { role: string; toolCallId?: string; content: string };
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.toolCallId).toBe('tc1');
    expect(toolMsg.content).toBe('{"sum":3}');
  });

  it('preserves system messages', () => {
    const out = convertMessagesToAgUi([
      { id: 's1', role: 'system', content: 'you are helpful', toolCalls: [], widgets: [] },
    ]);
    expect(out[0]!).toMatchObject({ role: 'system', content: 'you are helpful' });
  });
});

describe('convertToolsToAgUi', () => {
  it('produces JSON Schema parameters from a Zod schema', () => {
    const tool = agenticTool({
      name: 'bookFlight',
      description: 'Book a flight',
      schema: z.object({
        from: z.string(),
        to: z.string(),
        passengers: z.number().int().nonnegative(),
      }),
      handler: async () => undefined,
    }) as ToolDef;

    const [agUiTool] = convertToolsToAgUi([tool]);
    expect(agUiTool!.name).toBe('bookFlight');
    expect(agUiTool!.description).toBe('Book a flight');

    const params = agUiTool!.parameters as { type: string; properties: Record<string, { type: string }>; required?: string[] };
    expect(params.type).toBe('object');
    expect(Object.keys(params.properties).sort()).toEqual(['from', 'passengers', 'to']);
    expect(params.properties['from']!.type).toBe('string');
    expect(params.properties['passengers']!.type).toBe('integer');
    expect(params.required?.sort()).toEqual(['from', 'passengers', 'to']);
  });

  it('handles an empty tool array', () => {
    expect(convertToolsToAgUi([])).toEqual([]);
  });
});
