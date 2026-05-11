/**
 * Wire types for Microsoft Bot Framework — only the fields the
 * adapter actually consumes / emits. Full Activity schema is much
 * larger; keeping the surface small keeps the adapter
 * maintenance-light when MS bumps Bot Framework SDK versions.
 *
 * @see https://learn.microsoft.com/azure/bot-service/rest-api/bot-framework-rest-connector-activities
 */

/** A Bot Framework `ChannelAccount` -- either a user or the bot. */
export interface BotAccount {
  readonly id: string;
  readonly name?: string;
  readonly aadObjectId?: string;
}

/** Conversation a message belongs to. */
export interface BotConversation {
  readonly id: string;
  /** 'personal' (1:1 with the bot), 'groupChat', or 'channel'. */
  readonly conversationType?: 'personal' | 'groupChat' | 'channel';
  readonly tenantId?: string;
  readonly name?: string;
}

/** Incoming activity POSTed by Bot Framework to the bot's
 *  messaging endpoint. */
export interface BotActivity {
  readonly type: 'message' | 'conversationUpdate' | 'event' | 'invoke' | string;
  readonly id?: string;
  readonly timestamp?: string;
  readonly text?: string;
  readonly from?: BotAccount;
  readonly recipient?: BotAccount;
  readonly conversation: BotConversation;
  /** Bot-Connector base URL the bot replies to. Per-region; the
   *  adapter must POST replies back here. */
  readonly serviceUrl: string;
  readonly replyToId?: string;
  readonly channelId?: string;
  readonly locale?: string;
}

/** Identity surfaced to the handler. Mirrors the CopilotIdentity
 *  shape so adopters writing both adapters can share a mapper. */
export interface TeamsIdentity {
  readonly userId: string | null;
  readonly userName: string | null;
  readonly aadObjectId: string | null;
  readonly tenantId: string | null;
  readonly conversationId: string;
  readonly conversationType: 'personal' | 'groupChat' | 'channel' | null;
  readonly locale: string | null;
}

/** Events the bot handler yields during a run. Encoded as
 *  Adaptive Card attachments + text by the response builder. */
export type TeamsBotEvent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'adaptive-card'; readonly card: object; readonly summary?: string }
  | { readonly type: 'typing' }
  | { readonly type: 'error'; readonly message: string };

/** Handler the host wires. Receives the parsed activity + identity,
 *  yields events asynchronously. */
export type TeamsBotHandler = (input: {
  readonly activity: BotActivity;
  readonly identity: TeamsIdentity;
  readonly signal: AbortSignal;
}) => AsyncIterable<TeamsBotEvent>;

/** AAD credentials the adapter uses to acquire an OAuth bearer for
 *  posting replies back to the Bot Connector. */
export interface BotCredentials {
  /** Bot's AAD App registration id (also the Bot Framework appId). */
  readonly appId: string;
  /** Bot's AAD App secret. Loaded from env at server start; never
   *  passed through the wire. */
  readonly appPassword: string;
  /** Optional AAD tenant; defaults to 'botframework.com' (single-
   *  tenant bot template). For multi-tenant deployments set this
   *  to the tenant id from the inbound activity. */
  readonly tenantId?: string;
}
