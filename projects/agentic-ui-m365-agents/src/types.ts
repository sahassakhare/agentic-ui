/**
 * Wire types for Microsoft 365 Agents SDK — only the fields the
 * adapter actually consumes / emits.
 *
 * Activity shape mirrors classic Bot Framework — the M365 Agents SDK
 * is a successor that preserves the Activity protocol while adding
 * new channels (m365copilot, msteamsagents, directline, webchat, …)
 * and a broader set of AAD issuer endpoints. Adopters writing both
 * adapters can share most of the application code.
 *
 * @see https://learn.microsoft.com/microsoft-365/agents-sdk/
 * @see https://learn.microsoft.com/azure/bot-service/rest-api/bot-framework-rest-connector-activities
 */

/** Conversation participant — user or agent. */
export interface AgentAccount {
  readonly id: string;
  readonly name?: string;
  readonly aadObjectId?: string;
}

/** Conversation a message belongs to. */
export interface AgentConversation {
  readonly id: string;
  /**
   * 'personal' (1:1), 'groupChat', 'channel', or a channel-specific
   * conversation kind. M365 Copilot conversations report
   * `conversationType: 'personal'` with `channelId: 'm365copilot'`.
   */
  readonly conversationType?: 'personal' | 'groupChat' | 'channel' | string;
  readonly tenantId?: string;
  readonly name?: string;
}

/**
 * Incoming activity POSTed by an M365 Agents-channel hop (Bot
 * Connector for Teams, the M365 Agents service for Copilot
 * surfaces, Direct Line for embeddable web chats, …) to the
 * agent's messaging endpoint.
 */
export interface M365Activity {
  readonly type: 'message' | 'conversationUpdate' | 'event' | 'invoke' | string;
  readonly id?: string;
  readonly timestamp?: string;
  readonly text?: string;
  readonly from?: AgentAccount;
  readonly recipient?: AgentAccount;
  readonly conversation: AgentConversation;
  /**
   * Service URL the reply must be POSTed back to. Per-region for
   * Teams, per-channel for Copilot; the agent must echo it verbatim.
   */
  readonly serviceUrl: string;
  readonly replyToId?: string;
  /**
   * Channel id assigned by the Agents service. Common values:
   * 'msteams' | 'm365copilot' | 'directline' | 'webchat' |
   * 'msteamsagents'. Surfaced to the handler so it can branch UX
   * by channel (e.g. richer cards for Teams, plain text for
   * Copilot web).
   */
  readonly channelId?: string;
  readonly locale?: string;
}

/** Identity surfaced to the handler. */
export interface M365AgentIdentity {
  readonly userId: string | null;
  readonly userName: string | null;
  readonly aadObjectId: string | null;
  readonly tenantId: string | null;
  readonly conversationId: string;
  readonly conversationType: string | null;
  readonly channelId: string | null;
  readonly locale: string | null;
}

/**
 * Events the handler yields during a run. Encoded as Adaptive
 * Card attachments + text by the response builder. Identical
 * union to the Bot Framework adapter — switching adapters is a
 * package swap, not a handler rewrite.
 */
export type M365AgentEvent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'adaptive-card'; readonly card: object; readonly summary?: string }
  | { readonly type: 'typing' }
  | { readonly type: 'error'; readonly message: string };

/** Handler the host wires. Receives the parsed activity + identity,
 *  yields events asynchronously. */
export type M365AgentHandler = (input: {
  readonly activity: M365Activity;
  readonly identity: M365AgentIdentity;
  readonly signal: AbortSignal;
}) => AsyncIterable<M365AgentEvent>;

/** AAD credentials the adapter uses to acquire an OAuth bearer for
 *  posting replies back to the Agents service. */
export interface M365AgentCredentials {
  /** Agent's AAD App registration id (also the Bot Framework appId). */
  readonly appId: string;
  /** Agent's AAD App secret. Loaded from env at server start. */
  readonly appPassword: string;
  /**
   * AAD tenant. For single-tenant agents pass the tenant GUID.
   * For multi-tenant agents leave undefined — the adapter will use
   * 'botframework.com' for Bot Connector replies, and the tenantId
   * from the inbound activity for AAD-channel replies.
   */
  readonly tenantId?: string;
}
