# @infra-tools/agentic-ui-teams-bot

Microsoft Teams Bot Framework adapter for the
`@infra-tools/agentic-ui` platform. Lets the agent answer **inside
Teams chat** (channel / group chat / 1:1 DM) by posting Adaptive
Cards into the conversation.

This is **Path 1b** in
[docs/plans/teams-copilot-integration-plan.md](../../docs/plans/teams-copilot-integration-plan.md)
and is shipped under the architectural contract of
[ADR-041](../../docs/adr/0041-teams-copilot-external-surfaces.md).

> Already have the **Teams Tab** embed (Path 1a)? This package is
> the chat-native sibling. The Tab embeds your Angular app
> as-is; this adapter lets the agent converse directly in Teams
> with Adaptive Cards. Most production deployments ship both.

## What's in it

Pure protocol + transport. No LLM, no Angular dependency, no
catalog client. Adopters bring their own LLM behind a
`TeamsBotHandler`.

| Export | Purpose |
|---|---|
| `verifyBotJwt(opts)` | Verify the inbound `Authorization: Bearer <jwt>` against Microsoft's published Bot Connector keys |
| `resolveBotConnectorKey(kid)` | Fetch + cache a public key from `login.botframework.com/.well-known/openidconfiguration` |
| `parseBotActivity(json)` | Type-guarded read of an incoming Bot Framework activity |
| `readTeamsIdentity(activity)` | Pull `{userId, userName, aadObjectId, tenantId, conversationId, conversationType, locale}` |
| `welcomeCard(...)` / `errorCard(...)` | Stock Adaptive Cards |
| `widgetFallbackCard({name, props, deepLinkUrl?})` | Generic AC for tools that don't emit an `adaptiveCard` render hint |
| `asAttachment(card)` | Wrap a card in the right MIME for the Bot Connector |
| `sendReply(opts)` | POST a reply back to the inbound activity's `serviceUrl` |
| `acquireBotToken(creds)` | AAD client-credentials flow; bearer for sendReply |
| `createTeamsBotMiddleware({credentials, handler, ...})` | Connect-style request handler that ties everything together |
| Types: `BotActivity`, `BotCredentials`, `TeamsIdentity`, `TeamsBotEvent`, `TeamsBotHandler` | Public types |

## Wire it up (Express, ~30 lines)

```ts
import express from 'express';
import {
  createTeamsBotMiddleware,
  type TeamsBotHandler,
} from '@infra-tools/agentic-ui-teams-bot';

const handler: TeamsBotHandler = async function*({ activity, identity, signal }) {
  // Plug your own LLM here -- this stub just echoes.
  yield {
    type: 'text',
    text: `Hi ${identity.userName ?? 'there'}, you said: "${activity.text ?? '?'}"`,
  };
  // For richer responses, yield an adaptive-card event:
  yield {
    type: 'adaptive-card',
    summary: 'Quick stats',
    card: {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.5',
      body: [
        { type: 'TextBlock', text: 'Hello from your agent', weight: 'Bolder' },
      ],
    },
  };
};

const app = express();
app.post(
  '/api/messages',
  express.json({ limit: '2mb' }),
  createTeamsBotMiddleware({
    credentials: {
      appId: process.env['BOT_APP_ID']!,
      appPassword: process.env['BOT_APP_PASSWORD']!,
    },
    handler,
    // ONLY in local dev. Production must keep this false/unset.
    skipSignatureVerification: process.env['NODE_ENV'] !== 'production',
  }),
);
app.listen(3978, () => console.log('Teams bot listening on :3978'));
```

What the middleware does:

1. **Verifies the JWT bearer.** Reads `Authorization: Bearer <jwt>`,
   validates against Microsoft's published Bot Connector keys,
   checks `aud` against your bot's `appId`, `iss` against the
   allowed Bot Framework issuers, and `exp` against current time.
2. **Parses the activity** (`type`, `conversation`, `from`,
   `text`, `serviceUrl`).
3. **Branches on type**:
   - `conversationUpdate` (bot added to a chat) → posts a welcome
     card and returns. Adopters override via `welcome: () => ...`.
   - `message` → runs your handler, dispatches each yielded
     `TeamsBotEvent` as a Teams reply.
   - other types (`invoke`, `event`, ...) → 200 OK + no-op.
4. **On handler throw** → posts an `errorCard` to the user so
   the conversation doesn't go silent.

## Bridge an existing agent

When you already have a working `AgenticBackend.run(...)` loop
(e.g., the eDiscovery agent), the handler just translates
events. Most tool results carry an `adaptiveCard` render hint
(per ADR-041 D2) which is the highest-fidelity surface in Teams;
tools that don't get the generic `widgetFallbackCard` fallback
plus an "Open in app" deep-link to your Teams Tab.

```ts
import { widgetFallbackCard, type TeamsBotEvent } from '@infra-tools/agentic-ui-teams-bot';

const handler: TeamsBotHandler = async function*({ activity, identity, signal }) {
  const principal = await mapTeamsToCatalog(identity);

  for await (const ev of yourAgent.run({
    messages: [{ role: 'user', content: activity.text ?? '' }],
    principal, signal,
  })) {
    if (ev.type === 'TEXT_MESSAGE_CONTENT') {
      yield { type: 'text', text: ev.delta };
    } else if (ev.type === 'TOOL_CALL_RESULT' && ev.result) {
      // Tool emitted an adaptiveCard hint -- use it verbatim.
      if (hasAdaptiveCard(ev.result)) {
        yield { type: 'adaptive-card', card: (ev.result as { adaptiveCard: object }).adaptiveCard };
        continue;
      }
      // Tool emitted only components -- use the generic fallback.
      for (const c of (ev.result as { components?: Array<{name: string; props: unknown}> }).components ?? []) {
        yield {
          type: 'adaptive-card',
          card: widgetFallbackCard({
            name: c.name,
            props: c.props,
            deepLinkUrl: `https://teams.example.com/tab?entity=${encodeURIComponent(c.name)}`,
          }),
        };
      }
    }
  }
};

function hasAdaptiveCard(r: unknown): r is { adaptiveCard: object } {
  return Boolean(r && typeof r === 'object' && typeof (r as { adaptiveCard?: unknown }).adaptiveCard === 'object');
}
```

## GitHub App-style: Bot Framework registration

Production deploy needs an Azure Bot Service registration. Once
per environment:

1. Create an **Azure Bot** resource in the Azure Portal.
2. Register the **Microsoft App Id + Secret** (single-tenant is
   simplest; multi-tenant if your bot serves multiple AAD
   tenants).
3. Set the **Messaging endpoint** to your `POST /api/messages`
   URL (HTTPS only).
4. Enable the **Microsoft Teams** channel on the bot resource.
5. Build a Teams app manifest with a `bots` section pointing at
   the App Id; upload to Teams Admin Center.

See [docs/cookbook/teams-bot-adaptive-cards.md](../../docs/cookbook/teams-bot-adaptive-cards.md)
for the end-to-end walkthrough.

## Specs

21 tests cover the protocol surface:

- `parseBotActivity`: well-formed message, optional fields,
  rejects on missing required fields.
- `readTeamsIdentity`: full identity extraction + null defaults.
- Adaptive Card builders: `asAttachment`, `welcomeCard`,
  `errorCard`, `widgetFallbackCard` (title pick, fact set,
  object/array prop handling, deep-link action).
- `verifyBotJwt`: missing header, malformed JWT, audience
  check, issuer check, expiry check, unknown key, valid
  signature (real RSA round-trip + signed claims).

Run `npm test` from the package directory.

## What this does NOT do

- **No LLM.** Adopters bring their own.
- **No tool registry sync.** Catalog stays source of truth.
- **No audit fan-in.** When the bot's handler calls the catalog,
  it must pass `origin: 'teams-bot'` per ADR-041 D3.
- **No streaming.** Adaptive Cards aren't streamed mid-card; each
  yielded `TeamsBotEvent` is one Bot Connector POST. Adopters
  who need rapid progress use successive `text` events instead.

## Status

v0.1.0 — protocol + middleware shipped, three-week vertical slice
from the integration plan. AC schema pinned at 1.5 per
ADR-041 D7; bump per-adopter when M365 clients ship 1.6+ support.
