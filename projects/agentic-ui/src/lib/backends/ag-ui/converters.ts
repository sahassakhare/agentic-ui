import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Message, Tool } from '@ag-ui/client';
import type { AgenticMessage, ToolDef } from '../../internal';

/** Convert library `AgenticMessage`s to AG-UI's `Message[]` shape. */
export function convertMessagesToAgUi(messages: readonly AgenticMessage[]): Message[] {
  const out: Message[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ id: m.id, role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      out.push({
        id: m.id,
        role: 'assistant',
        content: m.content || undefined,
        toolCalls: m.toolCalls.length
          ? m.toolCalls.map((tc) => ({
              id: tc.toolCallId,
              type: 'function' as const,
              function: { name: tc.name, arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args ?? {}) },
            }))
          : undefined,
      });
      // Tool messages for any results we already have client-side
      for (const tc of m.toolCalls) {
        if (tc.result !== undefined) {
          out.push({
            id: `${tc.toolCallId}-result`,
            role: 'tool',
            toolCallId: tc.toolCallId,
            content: typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result),
          });
        }
      }
    } else if (m.role === 'system') {
      out.push({ id: m.id, role: 'system', content: m.content });
    } else if (m.role === 'tool') {
      out.push({ id: m.id, role: 'tool', toolCallId: m.id, content: m.content });
    }
  }
  return out;
}

/** Convert library `ToolDef[]` to AG-UI `Tool[]` (JSON-Schema parameters). */
export function convertToolsToAgUi(tools: readonly ToolDef[]): Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: zodToJsonSchema(t.schema, { target: 'jsonSchema7' }) as object,
  }));
}
