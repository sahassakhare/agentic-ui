import { zodToJsonSchema } from 'zod-to-json-schema';
import type { AgenticMessage, MessageContent, ToolDef } from '../../internal';

/**
 * Narrow, non-opinionated helpers shared by every backend adapter.
 *
 * **Deliberately not a canonical message-shape converter.** The lib's
 * internal `AgenticMessage` shape is what Hashbrown and A2UI servers
 * already consume; adopters wire their server to that shape. The only
 * shared converter we ship is for tools (because every backend
 * trips on the same "drop the Zod schema" mistake without help) and
 * for multi-modal content flattening (graceful degradation when a
 * backend doesn't advertise multiModal).
 *
 * Backends that want a different on-the-wire message shape (OpenAI
 * chat completions, Gemini, Anthropic, …) translate from
 * `AgenticMessage[]` themselves — there's no canonical intermediate.
 *
 * AG-UI is the exception: `@ag-ui/client` ships its own runtime
 * `Message` / `Tool` types and the AG-UI adapter lives with that
 * coupling. Its converters import `flattenContentToString` from here
 * but otherwise own their own shape.
 */

/**
 * Wire-friendly tool shape used by Hashbrown + A2UI POST bodies. AG-UI
 * uses the `@ag-ui/client` `Tool` type instead (similar fields,
 * different runtime nominal type).
 */
export interface WireTool {
  readonly name: string;
  readonly description: string;
  /** JSON-Schema 7 payload derived from the ToolDef's Zod schema. */
  readonly parameters: object;
}

/**
 * Coerce `AgenticMessage.content` (string | `MessageContent[]`) into a
 * single text string. Used by backends as a Capability F6 graceful
 * degradation when their server doesn't accept multi-part content.
 *
 * Text parts concatenate verbatim; images and files surface as
 * `[image: alt]` / `[file: name]` markers so the LLM at least sees
 * non-text content was attached.
 *
 * Public so adopters writing custom backends can reuse it.
 */
export function flattenContentToString(content: AgenticMessage['content']): string {
  if (typeof content === 'string') return content;
  const out: string[] = [];
  for (const p of content as readonly MessageContent[]) {
    if (p.kind === 'text') out.push(p.text);
    else if (p.kind === 'image') out.push(`[image${p.alt ? `: ${p.alt}` : ''} (${p.mimeType})]`);
    else out.push(`[file: ${p.filename}${p.sizeBytes ? ` · ${p.sizeBytes}B` : ''}]`);
  }
  return out.join('\n');
}

/**
 * Serialize a `ToolDef[]` for the wire with full Zod → JSON-Schema
 * conversion. Hashbrown + A2UI consume this directly. AG-UI's own
 * `convertToolsToAgUi` produces the equivalent shape with field
 * renames to match `@ag-ui/client`'s `Tool` runtime type.
 *
 * Closes the canonical L1 bug — before this slice, Hashbrown and
 * A2UI posted `{ name, description }` only, so the LLM behind those
 * backends saw tool names but no argument schema and silently
 * mis-typed calls.
 *
 * Schema target is `jsonSchema7` — broadly compatible with OpenAI /
 * Gemini / Anthropic tool specs.
 */
export function serializeToolsForWire(tools: readonly ToolDef[]): WireTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: zodToJsonSchema(t.schema, { target: 'jsonSchema7' }) as object,
  }));
}
