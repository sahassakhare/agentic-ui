# @infra-tools/agentic-ui-m365-agents

Microsoft 365 Agents SDK adapter for the `@infra-tools/agentic-ui` platform.

The successor to [`@infra-tools/agentic-ui-teams-bot`](../agentic-ui-teams-bot/README.md) — same Activity wire, broader channel set. Where the Bot Framework adapter targets Teams chat only, this adapter accepts traffic from every surface the M365 Agents service brokers:

- Microsoft Teams (channels, group chat, 1:1)
- Microsoft 365 Copilot (Word / Outlook / Teams Copilot pane / Copilot web)
- Direct Line (embeddable web chats)
- Webchat / DemoChat
- Sovereign clouds (Azure Government, Azure China, Azure Germany — via `additionalIssuerPrefixes`)

The same `M365AgentHandler` callback answers every channel. Your tool catalog, audit chain, and agent loop don't fork.

## Install

```bash
npm install @infra-tools/agentic-ui-m365-agents
```

## Quick start

```ts
import express from 'express';
import {
  createM365AgentMiddleware,
  type M365AgentEvent,
} from '@infra-tools/agentic-ui-m365-agents';

const app = express();

app.post(
  '/api/messages',
  express.json({ limit: '2mb' }),
  createM365AgentMiddleware({
    credentials: {
      appId: process.env.AGENT_APP_ID!,
      appPassword: process.env.AGENT_APP_PASSWORD!,
      // tenantId optional — set for single-tenant agents.
    },
    handler: async function* ({ activity, identity, signal }) {
      // identity.channelId — 'msteams' | 'm365copilot' | 'directline' | …
      // Branch UX per channel if you want richer cards in Teams and
      // plain text in the Copilot web pane.
      yield { type: 'typing' } satisfies M365AgentEvent;

      const reply = await yourLlm.run(activity.text, { signal });

      yield { type: 'text', text: reply.text };
      if (reply.card) yield { type: 'adaptive-card', card: reply.card };
    },
    // skipSignatureVerification: true,  // DEV ONLY — never in prod
  }),
);

app.listen(3978);
```

## Handler events

| Event type | Effect |
|---|---|
| `text` | Sends the string as a plain message activity. |
| `adaptive-card` | Sends an Activity with one `application/vnd.microsoft.card.adaptive` attachment. Optional `summary` is set as the message text fallback. |
| `typing` | No-op today (channel-specific). |
| `error` | Sends a red error card with the supplied message. |

## When to pick this adapter vs Bot Framework

| Scenario | Adapter |
|---|---|
| Greenfield deployment, want Teams + M365 Copilot from day one | **m365-agents** |
| Already deployed via Bot Framework SDK, no need for M365 Copilot channel | **teams-bot** |
| Tightest path to M365 Copilot (Word / Outlook / Teams pane) | **m365-agents** |
| Azure Government / Azure China / Azure Germany | **m365-agents** (use `additionalIssuerPrefixes`) |
| Just need M365 Copilot calling tools, no chat surface | **copilot-studio-connector** (different package — Power Platform OpenAPI) |

Both adapters share the same Activity wire and the same Adaptive Card builders, so swapping is a package + handler-shape change, not a rewrite.

## What's in the box

- `createM365AgentMiddleware({...})` — Connect-style request handler.
- `parseM365Activity(raw)` — type-guarded payload parser.
- `readM365AgentIdentity(activity)` — surface the user + channel identity to your audit pipeline.
- `verifyM365AgentJwt({...})` — JWT verifier covering Bot Connector (legacy) + AAD v1.0 + AAD v2.0 issuers. Bring your own resolver for tests; sovereign-cloud issuers via `additionalIssuerPrefixes`.
- `sendReply({...})` — POST a reply to the Agents service. Acquires + caches the AAD client-credentials bearer.
- Adaptive Card builders: `welcomeCard`, `errorCard`, `widgetFallbackCard`, `asAttachment`.

## One-time setup

1. Register your agent in Azure (AAD App + Agent registration).
2. Add your messaging endpoint (`https://<your-host>/api/messages`).
3. Generate an AAD client secret; expose as `AGENT_APP_ID` + `AGENT_APP_PASSWORD` env vars.
4. Install the channel(s) you want (Teams, M365 Copilot, Direct Line, …) on the Agent registration.

The adapter itself is channel-agnostic — once installed, additional channels work without code changes.

## License

[Apache 2.0](../../LICENSE)
