import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Message, Tool } from '@ag-ui/client';
import type { AgenticMessage, MessageContent, ToolDef } from '../../internal';

/**
 * Coerce an `AgenticMessage.content` (string | MessageContent[]) into a
 * single text string for backends that don't yet consume multi-modal
 * parts (Capability F6 graceful degradation).
 *
 * Text parts are concatenated verbatim; images / files surface as
 * `[image: alt]` / `[file: name]` markers so the LLM at least sees that
 * non-text content was attached. The AG-UI adapter treats this as the
 * v1 fallback; an upcoming slice extends the wire shape to pass parts
 * through natively when the AG-UI server advertises support.
 */
function flattenContent(content: AgenticMessage['content']): string {
  if (typeof content === 'string') return content;
  const out: string[] = [];
  for (const p of content as readonly MessageContent[]) {
    if (p.kind === 'text') out.push(p.text);
    else if (p.kind === 'image') out.push(`[image${p.alt ? `: ${p.alt}` : ''} (${p.mimeType})]`);
    else out.push(`[file: ${p.filename}${p.sizeBytes ? ` · ${p.sizeBytes}B` : ''}]`);
  }
  return out.join('\n');
}

/** Convert library `AgenticMessage`s to AG-UI's `Message[]` shape. */
export function convertMessagesToAgUi(messages: readonly AgenticMessage[]): Message[] {
  const out: Message[] = [];
  for (const m of messages) {
    const text = flattenContent(m.content);
    if (m.role === 'user') {
      out.push({ id: m.id, role: 'user', content: text });
    } else if (m.role === 'assistant') {
      out.push({
        id: m.id,
        role: 'assistant',
        content: text || undefined,
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
      out.push({ id: m.id, role: 'system', content: text });
    } else if (m.role === 'tool') {
      out.push({ id: m.id, role: 'tool', toolCallId: m.id, content: text });
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
