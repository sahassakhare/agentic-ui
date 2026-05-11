# Teams chat-native — Bot Framework + Adaptive Cards

Goal: the agent answers **inside Teams chat** (channel / group
chat / 1:1 DM). Tool results land as Adaptive Cards in the
conversation. Operators never leave Teams; same backend, same
tools, same audit chain as the web app.

This is **Path 1b** in
[../plans/teams-copilot-integration-plan.md](../plans/teams-copilot-integration-plan.md)
and shipped under
[ADR-041](../adr/0041-teams-copilot-external-surfaces.md).

> Complementary path: **Teams Tab** ([Path 1a](teams-tab-embed.md))
> embeds the full Angular UI as a tab. Most deployments ship
> both — Tab for the rich generative-UI surface, Bot for
> conversational drive.

## Architecture

```
   ┌──────────────┐  POST /api/messages       ┌──────────────────────┐
   │ Teams chat   │ ────────────────────────► │   your bot server    │
   │ user typing  │   (signed by Bot Connector)│                      │
   └──────────────┘                            │  verify → parse →    │
          ▲                                    │  run agent → AC      │
          │  Adaptive Card replies             │  reply via serviceUrl│
          └────────────────────────────────────┤                      │
                                               └──────────┬───────────┘
                                                          │
                                          AgenticBackend.run
                                                          ▼
                                          @maverick/agentic-ui catalog
                                          (same tools, same audit chain)
```

The skill wraps:

- Inbound JWT verification (Microsoft signs every Bot Connector
  call to your endpoint).
- Activity parsing (`type`, `from`, `conversation`, `text`).
- Outbound replies via the per-region `serviceUrl` + an AAD
  client-credentials bearer.
- A generic Adaptive Card fallback so tools without a
  hand-crafted `adaptiveCard` render hint still produce
  *something* visible in Teams.

## Step 1 — install

```bash
npm install @maverick/agentic-ui-teams-bot express
```

## Step 2 — implement the handler

```ts
// server/teams-handler.ts
import type {
  TeamsBotHandler,
  TeamsBotEvent,
} from '@maverick/agentic-ui-teams-bot';
import { widgetFallbackCard } from '@maverick/agentic-ui-teams-bot';
import { runAgent } from './my-agent';

const TAB_URL = 'https://your-app.example.com';

export const teamsHandler: TeamsBotHandler =
  async function*({ activity, identity, signal }) {
    const principal = await mapTeamsToCatalog(identity);
    if (!principal) {
      yield {
        type: 'text',
        text:
          `I couldn't find a catalog tenant for Teams tenant ` +
          `${identity.tenantId ?? '(unknown)'}. Ask an admin to ` +
          `add this Teams tenant to the catalog role-mappings.`,
      };
      return;
    }

    for await (const ev of runAgent({
      messages: [{ role: 'user', content: activity.text ?? '' }],
      principal,
      signal,
    })) {
      const out = toTeamsEvent(ev);
      if (out) yield out;
    }
  };

function toTeamsEvent(ev: { type: string; [k: string]: unknown }): TeamsBotEvent | null {
  if (ev['type'] === 'TEXT_MESSAGE_CONTENT') {
    return { type: 'text', text: ev['delta'] as string };
  }
  if (ev['type'] === 'TOOL_CALL_RESULT' && ev['result']) {
    const result = ev['result'] as {
      adaptiveCard?: object;
      components?: Array<{ name: string; props: unknown }>;
      markdown?: string;
    };
    if (result.adaptiveCard) {
      const out: TeamsBotEvent = { type: 'adaptive-card', card: result.adaptiveCard };
      if (result.markdown) (out as { summary?: string }).summary = result.markdown;
      return out;
    }
    if (result.components?.length) {
      const c = result.components[0]!;
      return {
        type: 'adaptive-card',
        card: widgetFallbackCard({
          name: c.name,
          props: c.props,
          deepLinkUrl: `${TAB_URL}/?widget=${encodeURIComponent(c.name)}`,
        }),
      };
    }
    if (result.markdown) {
      return { type: 'text', text: result.markdown };
    }
  }
  return null;
}
```

## Step 3 — mount the route

```ts
// server/main.ts
import express from 'express';
import { createTeamsBotMiddleware } from '@maverick/agentic-ui-teams-bot';
import { teamsHandler } from './teams-handler';

const app = express();
app.post(
  '/api/messages',
  express.json({ limit: '2mb' }),
  createTeamsBotMiddleware({
    credentials: {
      appId: process.env['BOT_APP_ID']!,
      appPassword: process.env['BOT_APP_PASSWORD']!,
    },
    handler: teamsHandler,
    skipSignatureVerification: process.env['NODE_ENV'] !== 'production',
  }),
);
app.listen(3978, () => console.log('Teams bot ready on :3978'));
```

## Step 4 — register the Azure Bot

One time per environment:

1. **Azure Portal → Azure Bot → Create**.
   - Bot type: **Multi-tenant** if your bot serves multiple AAD
     tenants. **Single tenant** is fine for one-org deployments.
   - **Microsoft App Id + Secret** generated for you (single
     tenant) or you provide an existing app registration
     (multi-tenant).
2. **Messaging endpoint** → `https://<your-host>/api/messages`.
3. **Channels → Microsoft Teams** → Apply.
4. Test in **Web Chat** in the portal first; activities flow
   into your endpoint with valid JWTs.

## Step 5 — write the Teams manifest

```jsonc
// teams/manifest.json (excerpt)
{
  "manifestVersion": "1.16",
  "id": "REPLACE-WITH-GUID",
  "packageName": "com.maverick.bot",
  "name": { "short": "eDiscovery Bot", "full": "Maverick eDiscovery — agent" },
  "description": { "short": "...", "full": "..." },
  "developer": { "name": "Maverick", "websiteUrl": "https://...", ... },
  "icons": { "color": "color.png", "outline": "outline.png" },
  "accentColor": "#1E3A5F",
  "bots": [{
    "botId": "REPLACE-WITH-AAD-APP-ID",
    "scopes": ["personal", "team", "groupChat"],
    "supportsFiles": false,
    "isNotificationOnly": false
  }],
  "permissions": ["identity", "messageTeamMembers"],
  "validDomains": []
}
```

Zip with the icons; upload via **Teams Admin Center → Manage apps
→ Upload**.

## Identity → catalog principal

The webhook surfaces:

| Field | From the activity |
|---|---|
| `userId` | `from.id` (channel-specific id) |
| `userName` | `from.name` |
| `aadObjectId` | `from.aadObjectId` (the AAD user GUID; stable across channels) |
| `tenantId` | `conversation.tenantId` (the AAD tenant id) |
| `conversationId` | `conversation.id` |
| `conversationType` | `'personal' | 'groupChat' | 'channel'` |
| `locale` | the user's Teams locale |

`readTeamsIdentity(activity)` extracts these. Your
`mapTeamsToCatalog(identity)` then translates to the catalog's
principal — typically `tenantId` → catalog tenant, `aadObjectId` →
catalog user, lookup roles via the existing `role-mappings` table
(see ADR-016).

## Audit fan-in

Every tool invocation from a Teams user should write an audit
row with `origin: 'teams-bot'` (per ADR-041 D3):

```ts
await appendAudit({
  tenantId, actor, requestId, operation, entityType, entityId, diff,
  origin: 'teams-bot',
});
```

The ops console activity feed filters by origin so Teams-driven
mutations stand out from web-driven ones.

## Fidelity matrix (what works in Teams chat)

| Capability | Teams chat fidelity |
|---|---|
| **F4 approvals** | ✅ Native — Adaptive Card has approve/reject actions |
| **F5 long-running** | ✅ Progress card updates per refresh |
| **F1 forms** | ⚠️ Partial — `Input.*` elements work, `if:` predicate evaluation doesn't |
| **F3 workflows** | ⚠️ One card per step; user clicks "Next" → posts back |
| **F1-dyn dynamic forms** | ⚠️ Text fallback or "Open in Tab" deep-link |
| **F6 multi-modal** | ⚠️ Image attachments via AC; no rich preview |

For anything that needs the rich Angular surface, include an
`Action.OpenUrl` button in your Adaptive Cards that deep-links
into the Teams Tab embed:

```ts
actions: [
  { type: 'Action.OpenUrl', title: 'Open in app',
    url: `https://teams.example.com/?entity=holds.${holdId}` },
]
```

## Local development

The middleware honours `skipSignatureVerification: true` for local
dev. Use the [Bot Framework Emulator](https://github.com/microsoft/BotFramework-Emulator)
to drive activities into your local endpoint without going
through Azure / Teams.

```bash
# Tunnel your localhost to a public URL Azure can reach.
ngrok http 3978
# Set the Azure Bot's messaging endpoint to the ngrok HTTPS URL.
# Use Bot Framework Emulator (file → open URL: http://localhost:3978/api/messages).
```

## What's next

- **Hand-AC mappers per tool.** The generic
  `widgetFallbackCard` is fine for prototyping; replace per-tool
  with hand-crafted AC schemas for production polish. Set the
  `adaptiveCard` field on `ToolResultRenderHints` and the
  middleware uses it verbatim.
- **Streaming text.** Long agent responses can chunk via
  successive `text` events for a typewriter feel; Bot Framework
  delivers them as separate messages.
- **Conversation continuity.** The skill currently treats every
  inbound `message` independently. Wire your catalog's thread
  store to the `conversation.id` to keep multi-turn context.
