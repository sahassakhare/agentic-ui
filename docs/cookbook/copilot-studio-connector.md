# Microsoft Copilot Studio — Connector wiring

Goal: expose the agentic-ui catalog tools to **Microsoft 365
Copilot** through a Power Platform custom Connector. M365 Copilot
users — across Word, Outlook, Teams, the Copilot web surface —
invoke our tools by name; the Connector forwards into our agent
server.

This is **Path 1c** in
[../plans/teams-copilot-integration-plan.md](../plans/teams-copilot-integration-plan.md)
and detailed in
[ADR-042](../adr/0042-copilot-studio-connector.md).

> Adapter package: `@maverick/agentic-ui-copilot-studio-connector`.
> Sibling adapters cover GitHub Copilot Chat ([P2](github-copilot-extension.md)),
> Teams chat ([P1](teams-bot-adaptive-cards.md)), and the Teams Tab
> embed ([P0](teams-tab-embed.md)). Most production deployments
> ship a subset.

## Architecture

```
   ┌────────────────────┐      OpenAPI manifest      ┌────────────────────┐
   │  M365 Copilot      │   ──── (build time) ────►  │  Power Platform    │
   │  / Copilot Studio  │                            │  Custom Connector  │
   └─────────┬──────────┘                            └──────────┬─────────┘
             │                                                  │
             │  user asks "place a legal hold..."               │
             │  Copilot calls action -> Connector dispatches    │
             ▼                                                  ▼
   ┌────────────────────────────────────────────────────────────────────┐
   │  POST /api/copilot-studio/actions/{toolName}                       │
   │  Authorization: Bearer <AAD v2.0 JWT for the signed-in M365 user> │
   │                                                                    │
   │  ┌─── @maverick/agentic-ui-copilot-studio-connector ───────────┐   │
   │  │  verifyConnectorJwt  →  readConnectorIdentity  →  handler   │   │
   │  └─────────────────────────────────────────────────────────────┘   │
   │                                ↓                                   │
   │                       AgenticBackend.run                           │
   │                                ↓                                   │
   │                    @maverick/agentic-ui catalog                    │
   │                    (same tools, same audit chain)                  │
   └────────────────────────────────────────────────────────────────────┘
```

## Step 1 — install

```bash
npm install @maverick/agentic-ui-copilot-studio-connector express
```

## Step 2 — generate the Connector manifest at build time

The OpenAPI manifest is a build artefact. Re-run when tools'
schemas change:

```ts
// scripts/build-connector.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { z } from 'zod';
import { buildConnectorManifest } from '@maverick/agentic-ui-copilot-studio-connector';

mkdirSync('dist', { recursive: true });

const manifest = buildConnectorManifest({
  title: 'Maverick eDiscovery',
  description: 'Custodian / legal-hold / production catalog actions for M365 Copilot.',
  version: '1.0.0',
  host: 'agent.example.com',
  aadAppId: process.env.BOT_APP_ID!,
  aadTenantId: process.env.AAD_TENANT_ID,
  tools: [
    {
      name: 'placeLegalHold',
      description: 'Issue a legal hold for one or more custodians.',
      schema: z.object({
        custodianIds: z.array(z.string()).min(1),
        scope: z.string().min(10).describe('Plain-English scope of the hold.'),
      }),
    },
    {
      name: 'addCustodian',
      description: 'Add a custodian to the active matter.',
      schema: z.object({
        name: z.string(),
        email: z.string().email(),
        department: z.string(),
      }),
      summary: 'Onboard custodian',
    },
    // ... one entry per catalog tool you want surfaced to Copilot.
  ],
});

writeFileSync('dist/connector-manifest.json', JSON.stringify(manifest, null, 2));
console.log('connector manifest:', `dist/connector-manifest.json`);
```

Run with `tsx scripts/build-connector.ts` — emit a JSON file
Power Platform can import directly.

## Step 3 — implement the action handlers

Each Connector action lands at
`POST /api/copilot-studio/actions/:toolName`. Wire a handler
per tool name; the middleware does verify + parse + dispatch.

```ts
// server/copilot-studio-handlers.ts
import type { ConnectorActionHandler } from '@maverick/agentic-ui-copilot-studio-connector';
import { runAgent, mapAadToCatalog } from './my-agent';

export const handlers = new Map<string, ConnectorActionHandler>();

handlers.set('placeLegalHold', async ({ args, identity, signal }) => {
  const principal = await mapAadToCatalog(identity);
  const result = await runAgent({
    toolName: 'placeLegalHold',
    args,
    principal,
    signal,
  });
  return {
    message: `Hold issued — ${result.holdId} covering ${result.custodianCount} custodian(s).`,
    adaptiveCard: result.adaptiveCard,
    data: { holdId: result.holdId },
  };
});

handlers.set('addCustodian', async ({ args, identity, signal }) => {
  const principal = await mapAadToCatalog(identity);
  const cust = await runAgent({ toolName: 'addCustodian', args, principal, signal });
  return {
    message: `Custodian ${cust.id} added (${cust.name}).`,
    data: { custodianId: cust.id },
  };
});
```

## Step 4 — mount the route

```ts
// server/main.ts
import express from 'express';
import { createConnectorMiddleware } from '@maverick/agentic-ui-copilot-studio-connector';
import { handlers } from './copilot-studio-handlers';

const app = express();
app.post(
  '/api/copilot-studio/actions/:toolName',
  express.json({ limit: '2mb' }),
  createConnectorMiddleware({
    handlers,
    credentials: {
      expectedAudience: process.env.BOT_APP_ID!,
      allowedTenants: [process.env.AAD_TENANT_ID!],
    },
    skipSignatureVerification: process.env.NODE_ENV !== 'production',
  }),
);
app.listen(8080, () => console.log('Connector ready on :8080'));
```

## Step 5 — register an Azure AD app for the Connector

One time per environment. The same AAD app the Teams Bot uses
can double as the Connector audience.

1. **Azure Portal → App registrations → New registration**.
   Single-tenant for org-internal deployments; multi-tenant if
   you'll serve external tenants.
2. **Expose an API → Add a scope** named `.default`. Scope
   identifier: `api://{app-id}/.default`.
3. **Certificates & secrets → New client secret**. Save the
   value as `BOT_APP_PASSWORD` (only shown once).
4. **API permissions** — none needed beyond the default; this
   app is an audience, not a delegated caller.

## Step 6 — import the Connector into Power Platform

1. **Power Platform admin** ([https://make.powerapps.com](https://make.powerapps.com))
   → **Custom connectors** → **New custom connector** →
   **Import an OpenAPI file**.
2. Upload `dist/connector-manifest.json`.
3. On the **Security** screen, paste the AAD app id + the
   `.default` scope. Power Platform pre-fills the rest from the
   manifest's `securityDefinitions`.
4. On the **Test** screen, sign in with an M365 user from the
   allowed tenant + invoke one of the actions. Should return
   200 + the agreed `{ message, adaptiveCard, data }` shape.
5. **Publish**.

## Step 7 — make it available in Copilot Studio

1. **Copilot Studio** → your Copilot → **Tools** → **Add a tool**
   → **Custom connector** → pick the connector you just
   published.
2. For each action, set a **trigger phrase** (when should Copilot
   call this action?) and an **example user prompt**. Copilot's
   NL routing learns from these.
3. **Publish** the Copilot.

Open M365 Copilot and try a prompt like *"Place a legal hold on
Sarah Chen for Project Phoenix"*. Copilot routes the call into
our Connector → our agent server → catalog mutation + audit row.

## Identity → catalog principal

The middleware exposes the validated JWT claims via
`readConnectorIdentity(claims)`:

| Field | From AAD claim |
|---|---|
| `tenantId` | `tid` |
| `userObjectId` | `oid` (stable across name changes) |
| `userPrincipalName` | `preferred_username` → `upn` fallback |
| `roles` | `roles[]` (AAD app roles assigned to the user) |
| `groups` | `groups[]` (AAD security groups the user belongs to) |

Your `mapAadToCatalog(identity)` translates these into the
catalog's principal — typically `tid` → catalog tenant,
`oid` → catalog user, lookup roles via the existing
`role-mappings` table (ADR-016).

## Audit fan-in

Per ADR-041 D3, every catalog mutation initiated through
Copilot Studio should set `origin: 'copilot-studio'`:

```ts
await appendAudit({
  tenantId, actor, requestId, operation, entityType, entityId, diff,
  origin: 'copilot-studio',
});
```

The ops console activity feed (ADR-030) filters by `origin` so
Copilot-Studio-driven changes are visible separately from
web / Teams / GitHub Copilot ones.

## Per-persona Connectors

Multi-persona deployments don't want M365 Copilot users to see
every catalog tool — junior staff shouldn't be able to invoke
`exportProductionSet` from a Copilot prompt. Per ADR-042 D5,
publish one Connector per persona:

```ts
for (const persona of ['lead-counsel', 'associate', 'paralegal']) {
  const scoped = toolList.filter((t) => personaCanInvoke(persona, t));
  writeFileSync(
    `dist/connector-${persona}.json`,
    JSON.stringify(buildConnectorManifest({ ...baseOpts, tools: scoped })),
  );
}
```

Power Platform assigns Connectors to security groups; AAD admins
control which users see which Connector.

## Fidelity matrix

| Capability | Renders in Copilot Studio |
|---|---|
| **F4 approvals** | ✅ Native AC with approve/reject actions |
| **F5 long-running** | ⚠️ Synchronous turn — return `data.opId` + a "check status" hint in `message` |
| **F1 forms** | ⚠️ Partial — `Input.*` AC elements work; `if:` predicate evaluation doesn't |
| **F3 workflows** | ⚠️ One Copilot turn per step (the user re-prompts each time) |
| **F1-dyn dynamic forms** | ⚠️ Text fallback or deep-link to web app |
| **F6 multi-modal** | ❌ Not supported through Connectors |

For anything that needs the rich Angular surface, include an
`Action.OpenUrl` in your Adaptive Cards that deep-links into the
Teams Tab embed.

## Schema rotation + Connector versioning

When a tool's Zod schema changes:

1. Bump `version` in your `buildConnectorManifest` call.
2. Re-run the build step → new `connector-manifest.json`.
3. In Power Platform, **Custom connectors → your connector →
   Update from OpenAPI** → upload the new file.
4. Connections from existing users continue to use the prior
   version until they re-authenticate. Plan migrations
   accordingly.

## Local development

`createConnectorMiddleware` honours `skipSignatureVerification:
true` for local dev. Use `curl` to drive your endpoint:

```bash
curl -X POST http://localhost:8080/api/copilot-studio/actions/placeLegalHold \
  -H 'Content-Type: application/json' \
  -d '{"custodianIds":["c-001"],"scope":"Project Phoenix emails Q1 2025"}'
```

Power Platform itself doesn't have a "live preview" against a
localhost endpoint — use `ngrok` or `cloudflared` to tunnel for
end-to-end testing.

## What's next

- **Marketplace certification** — Public Connector listing
  requires Microsoft Partner Center cert. Out of scope here.
- **Connection sharing** — Power Platform supports sharing a
  Connector across environments; useful when you have dev /
  staging / prod tenants.
- **Telemetry** — Power Platform's built-in connector usage
  view shows per-action invocation counts. Combine with the
  usage meter (ADR-018) keyed on `origin: 'copilot-studio'`.
