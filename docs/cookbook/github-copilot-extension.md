# GitHub Copilot Extension — wire your catalog tools

Goal: invoke any tool registered with the agentic-ui catalog from
**GitHub Copilot Chat** (VS Code, JetBrains, github.com). The
developer types a natural-language request in Copilot Chat; our
skill routes through their identity and runs the agent server-side.

This is **Path 2a** in
[../plans/teams-copilot-integration-plan.md](../plans/teams-copilot-integration-plan.md)
and is shipped under
[ADR-041](../adr/0041-teams-copilot-external-surfaces.md).

## Architecture (one paragraph)

```
   ┌──────────────┐    POST /copilot/skill         ┌──────────────────────┐
   │ Copilot Chat │ ─────────────────────────────► │  your skill server   │
   │ (IDE/web)    │       (signed body, GH headers)│  (Express, ~30 LOC)  │
   └──────────────┘                                │                      │
          ▲                                        │   verify → parse →   │
          │  SSE chat-completion chunks            │   run agent → stream │
          └────────────────────────────────────────┤                      │
                                                   └─────────┬────────────┘
                                                             │
                                          AgenticBackend.run │
                                                             ▼
                                          @infra-tools/agentic-ui catalog
                                          (same tools, same audit chain)
```

`@infra-tools/agentic-ui-copilot-skill` covers the boxed boilerplate —
signature verify, body parse, OpenAI-shaped SSE serialise. You
write the `SkillHandler` that bridges Copilot's `messages` array
into your existing agent loop.

## Step 1 — install the skill package

```bash
npm install @infra-tools/agentic-ui-copilot-skill express
```

## Step 2 — implement the handler

The handler is a plain async generator. Each `yield` becomes one
SSE chunk Copilot Chat displays in-line.

```ts
// server/copilot-handler.ts
import type {
  SkillHandler,
  SkillEvent,
} from '@infra-tools/agentic-ui-copilot-skill';
import { runAgent } from './my-agent';  // your existing agent loop

export const copilotHandler: SkillHandler =
  async function*({ body, identity, signal }) {
    // 1. Map the GitHub identity to your catalog's principal.
    const principal = await mapGitHubToCatalog(identity);
    if (!principal) {
      yield { type: 'text-delta', delta:
        `I can't find a catalog tenant for GitHub user ` +
        `${identity.githubUserLogin ?? '(unknown)'}.` };
      yield { type: 'finish', reason: 'stop' };
      return;
    }

    // 2. Run your agent loop. Yields AG-UI events; bridge each to
    //    the skill-event shape.
    for await (const ev of runAgent({
      messages: body.messages,
      principal,
      signal,
    })) {
      const out = toSkillEvent(ev);
      if (out) yield out;
    }
  };

function toSkillEvent(ev: { type: string; [k: string]: unknown }): SkillEvent | null {
  switch (ev.type) {
    case 'TEXT_MESSAGE_CONTENT':
      return { type: 'text-delta', delta: ev['delta'] as string };
    case 'TOOL_CALL_RESULT':
      return {
        type: 'tool-call',
        toolCallId: ev['toolCallId'] as string,
        name: ev['name'] as string,
        args: ev['args'],
      };
    case 'RUN_FINISHED':
      return { type: 'finish', reason: 'stop' };
    default:
      return null;
  }
}
```

The middleware will auto-emit a terminal `finish` if your handler
forgets — but emit it explicitly for clarity.

## Step 3 — mount the route

```ts
// server/main.ts
import express from 'express';
import { createCopilotSkillMiddleware } from '@infra-tools/agentic-ui-copilot-skill';
import { copilotHandler } from './copilot-handler';

const app = express();

app.post(
  '/copilot/skill',
  // CRITICAL: raw body for signature verification.
  // Do NOT use express.json() ahead of this.
  express.raw({ type: 'application/json', limit: '2mb' }),
  createCopilotSkillMiddleware({
    handler: copilotHandler,
    skipSignatureVerification: process.env['NODE_ENV'] !== 'production',
    model: 'maverick-ediscovery',
  }),
);

app.listen(8080, () => console.log('Skill ready on :8080'));
```

That's the whole server.

## Step 4 — register the GitHub App

The webhook needs a GitHub App. One time per environment:

1. https://github.com/settings/apps → **New GitHub App**
2. Webhook URL: `https://your-host.example.com/copilot/skill`
3. Permissions:
   - `Account permissions → Copilot Chat: Read & Write`
   - `User permissions → Email addresses: Read-only` (for the
     identity headers)
4. Subscribe to events: none required for the webhook protocol.
5. Install the app on your test org / personal account.

GitHub now signs every Copilot Chat call to your webhook with its
rotating ECDSA P-256 key pair. The skill's `verifyCopilotRequest`
validates against `api.github.com/meta/public_keys/copilot_api` —
nothing for you to configure beyond setting
`NODE_ENV=production`.

## Step 5 — write the extension manifest

In your skill repo (or your existing agent-server repo), add:

```yaml
# .github/copilot-extension.yml
name: maverick-ediscovery
description: Agentic eDiscovery — custodian intake, legal holds, productions
endpoints:
  - name: chat
    url: https://your-host.example.com/copilot/skill
    type: openai-chat-completions
```

Push the file and re-install the app from the GitHub App settings;
Copilot Chat picks up the manifest within a few minutes.

## Step 6 — try it

In any IDE with Copilot Chat:

```
@maverick-ediscovery onboard a Finance custodian named Alice Chen
```

The `@` prefix routes the message into your skill. Copilot Chat
streams the response back.

## Identity → catalog principal

The webhook receives these GitHub headers:

| Header | Value |
|---|---|
| `X-GitHub-User` | login string (e.g. `alice`) |
| `X-GitHub-User-Id` | numeric id |
| `X-GitHub-Enterprise` | enterprise slug (if installed at enterprise) |
| `X-GitHub-Org` | org slug(s), comma-separated |

`readCopilotIdentity(headers)` normalises these. Your
`mapGitHubToCatalog(identity)` then translates to the catalog's
`principal` shape. Typical mapping table:

| Catalog field | Mapped from |
|---|---|
| `tenantId` | `identity.enterprise` (enterprise install) or `identity.orgs[0]` |
| `sub` | `identity.githubUserLogin` |
| `roles` | role-mappings lookup keyed on `identity.orgs` |

The catalog's existing `role-mappings` table (ADR-016) already
supports claims-based persona resolution; pass the GitHub org list
through and it Just Works.

## Audit fan-in

Every tool call from a Copilot user should write an audit row
with `origin: 'github-copilot'` (per ADR-041 D3). Wire this in
your agent loop wherever it calls the catalog's `appendAudit`
helper:

```ts
await appendAudit({
  tenantId, actor, requestId, operation, entityType, entityId, diff,
  origin: 'github-copilot',
});
```

The ops console's Activity feed can then filter by origin to
separate Copilot-driven mutations from web-driven ones.

## Limitations

- **No rich generative UI.** Copilot Chat renders text + markdown.
  Forms (F1), workflows (F3), and approval cards (F4) degrade to
  markdown summaries with deep-links into your web UI.
- **No multi-modal input.** Copilot Chat is text-only at the skill
  webhook level. F6 multi-modal flows aren't reachable from this
  surface.
- **Synchronous turn.** Long-running tools (F5) should fire
  asynchronously and return an `opId` the user can check in a
  follow-up turn — Copilot Chat will time out at ~120s otherwise.

## Local development

Run a local server with `NODE_ENV=development` (or pass
`skipSignatureVerification: true` to the middleware). Use `curl`
to drive it:

```bash
curl -N -X POST http://localhost:8080/copilot/skill \
  -H 'Content-Type: application/json' \
  -H 'X-GitHub-User: yourname' \
  -H 'X-GitHub-Org: acme' \
  -d '{"messages":[{"role":"user","content":"hello"}]}'
```

The response is the SSE stream. `-N` prevents curl from buffering
so you see chunks land in real time.

## What's next

Path 2a covers the skill webhook. Two follow-up paths exist:

- **Path 2b** — GitHub Copilot Workspace custom agent. Deferred
  pending Workspace API maturity.
- **Path 1c** — Microsoft Copilot Studio Connector. Different
  ecosystem entirely; see the integration plan §3 for the trade-
  offs.
