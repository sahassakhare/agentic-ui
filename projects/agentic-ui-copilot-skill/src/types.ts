/**
 * Wire types for the GitHub Copilot Extensions protocol. We keep
 * these minimal -- only the fields the skill actually consumes /
 * emits. Spec reference:
 * https://docs.github.com/copilot/building-copilot-extensions/
 */

/** One message in the Copilot chat history. */
export interface CopilotMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool';
  readonly content: string;
  /** Present when role === 'assistant' and the message includes
   *  tool calls. */
  readonly tool_calls?: ReadonlyArray<{
    readonly id: string;
    readonly type: 'function';
    readonly function: { readonly name: string; readonly arguments: string };
  }>;
  /** Present when role === 'tool'. */
  readonly tool_call_id?: string;
  readonly name?: string;
}

/** Incoming POST body from Copilot Chat. */
export interface CopilotRequestBody {
  readonly messages: readonly CopilotMessage[];
  readonly copilot_thread_id?: string;
  readonly copilot_skills?: readonly string[];
}

/** Identity fields GitHub passes in headers when Copilot Chat
 *  invokes the skill. The skill uses these to map the GitHub user
 *  into the catalog's principal shape. */
export interface CopilotIdentity {
  readonly githubUserId: string | null;
  readonly githubUserLogin: string | null;
  readonly enterprise: string | null;
  readonly orgs: readonly string[];
}

/** Events the handler emits during a run. Mirrors the
 *  AgenticEvent vocabulary in @infra-tools/agentic-ui but with the
 *  fields Copilot's SSE chunks actually carry. */
export type SkillEvent =
  | { readonly type: 'text-delta'; readonly delta: string }
  | { readonly type: 'tool-call';
      readonly toolCallId: string;
      readonly name: string;
      readonly args: unknown }
  | { readonly type: 'tool-result';
      readonly toolCallId: string;
      readonly result: unknown }
  | { readonly type: 'finish'; readonly reason?: 'stop' | 'tool_calls' | 'length' | 'error' };

/** Handler the host wires. Receives the parsed request + identity,
 *  yields events asynchronously. Each yield is encoded by
 *  `streamCopilotResponse(...)` into an OpenAI-shaped SSE chunk
 *  that Copilot Chat consumes. */
export type SkillHandler = (input: {
  readonly body: CopilotRequestBody;
  readonly identity: CopilotIdentity;
  readonly signal: AbortSignal;
}) => AsyncIterable<SkillEvent>;
