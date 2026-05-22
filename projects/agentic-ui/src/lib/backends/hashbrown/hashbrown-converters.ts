import type { Chat } from '@hashbrownai/core';
import type { AgenticMessage } from '../../internal';
import { flattenContentToString } from '../_shared/canonical-messages';

/**
 * Hashbrown request converters.
 *
 * Hashbrown's `Chat.Api.CompletionCreateParams` separates the `system`
 * prompt from the `messages` array (unlike AG-UI, where system is a
 * message), and its message roles are `user | assistant | tool | error`
 * — there is no `system` message role on the wire. These helpers map the
 * library's `AgenticMessage[]` onto that shape so the adapter is a real
 * client of `@hashbrownai/core`, not a look-alike.
 *
 * Tool serialization is shared: `serializeToolsForWire` already emits
 * `{ name, description, parameters }`, which is exactly `Chat.Api.Tool`.
 */

/**
 * Split the library messages into Hashbrown's `{ system, messages }`.
 * The first `system` message (if any) becomes the `system` prompt;
 * subsequent system messages are concatenated. Everything else maps to a
 * `Chat.Api.Message`.
 */
export function convertMessagesToHashbrown(
  messages: readonly AgenticMessage[],
): { system: string; messages: Chat.Api.Message[] } {
  const systemParts: string[] = [];
  const out: Chat.Api.Message[] = [];

  for (const m of messages) {
    const text = flattenContentToString(m.content);
    switch (m.role) {
      case 'system':
        if (text) systemParts.push(text);
        break;
      case 'user':
        out.push({ role: 'user', content: text });
        break;
      case 'assistant':
        out.push({
          role: 'assistant',
          content: text || undefined,
          toolCalls: m.toolCalls.length
            ? m.toolCalls.map((tc, index) => ({
                index,
                id: tc.toolCallId,
                type: 'function',
                function: {
                  name: tc.name,
                  arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args ?? {}),
                },
              }))
            : undefined,
        });
        // Surface any client-side tool results as Hashbrown `tool`
        // messages so the next turn sees them (Hashbrown carries the
        // result as a `PromiseSettledResult`).
        for (const tc of m.toolCalls) {
          if (tc.result !== undefined) {
            out.push({
              role: 'tool',
              toolCallId: tc.toolCallId,
              toolName: tc.name,
              content: { status: 'fulfilled', value: tc.result },
            });
          } else if (tc.error) {
            out.push({
              role: 'tool',
              toolCallId: tc.toolCallId,
              toolName: tc.name,
              content: { status: 'rejected', reason: tc.error },
            });
          }
        }
        break;
      case 'tool':
        out.push({
          role: 'tool',
          toolCallId: m.id,
          toolName: m.id,
          content: { status: 'fulfilled', value: text },
        });
        break;
    }
  }

  return { system: systemParts.join('\n\n'), messages: out };
}
