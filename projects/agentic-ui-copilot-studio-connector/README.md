# @infra-tools/agentic-ui-copilot-studio-connector

Microsoft Copilot Studio Connector adapter for the
`@infra-tools/agentic-ui` platform. Translates Zod tool schemas
into a **Power Platform Connector** OpenAPI 3 manifest, verifies
inbound Azure AD JWTs, and dispatches action handlers with
Adaptive Card responses.

Path **1c** in
[docs/plans/teams-copilot-integration-plan.md](../../docs/plans/teams-copilot-integration-plan.md).
Specifics in [ADR-042](../../docs/adr/0042-copilot-studio-connector.md).

> Sibling adapters:
> - **Teams Tab** ([P0](../../docs/cookbook/teams-tab-embed.md))
> - **Teams Bot Framework** (`@infra-tools/agentic-ui-teams-bot`, P1)
> - **GitHub Copilot Extension** (`@infra-tools/agentic-ui-copilot-skill`, P2)
> - **MS Copilot Studio** (this package, P3)

## What's in it

Protocol + manifest. No LLM, no Angular dependency. Adopters
bring their own agent loop behind a `ConnectorActionHandler`.

| Export | Purpose |
|---|---|
| `zodToOpenApi(schema)` | Translate a Zod schema → OpenAPI 3 fragment (subset: string/number/boolean/enum/array/object/optional/nullable/default/describe; refinements: min/max/length/email/url/uuid) |
| `buildConnectorManifest(opts)` | Aggregate tool defs into a full Power Platform Connector OpenAPI 2.0 doc (Swagger -- Power Platform still uses it for custom connectors) |
| `verifyConnectorJwt(opts)` | Validate the Azure AD v2.0 bearer Power Platform attaches to every Connector call |
| `resolveAadKey(kid, tenant)` | Fetch + cache a JWKS key from `login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration` |
| `readConnectorIdentity(claims)` | Pull `{tenantId, userObjectId, userPrincipalName, roles, groups}` from validated claims |
| `createConnectorMiddleware({handlers, credentials, ...})` | Connect-style request handler that ties verify + parse + dispatch + respond together |
| Types: `ConnectorToolDef`, `ConnectorActionHandler`, `ConnectorActionResult`, `ConnectorIdentity`, `OpenApiSchema` | Public types |

## Wire it up

```ts
// 1. Generate the manifest (build time).
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { buildConnectorManifest } from '@infra-tools/agentic-ui-copilot-studio-connector';

const manifest = buildConnectorManifest({
  title: 'Maverick eDiscovery',
  description: 'Catalog tools exposed to M365 Copilot.',
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
        scope: z.string().min(10),
      }),
    },
    // ... one entry per catalog tool
  ],
});
writeFileSync('dist/connector-manifest.json', JSON.stringify(manifest, null, 2));
```

```ts
// 2. Run the agent (runtime).
import express from 'express';
import {
  createConnectorMiddleware,
  type ConnectorActionHandler,
} from '@infra-tools/agentic-ui-copilot-studio-connector';

const handlers = new Map<string, ConnectorActionHandler>();
handlers.set('placeLegalHold', async ({ args, identity, signal }) => {
  const principal = await mapAadToCatalog(identity);
  const hold = await yourAgent.dispatch('placeLegalHold', args, principal, signal);
  return {
    message: `Hold issued — ${hold.id} covering ${hold.custodianIds.length} custodian(s).`,
    adaptiveCard: hold.adaptiveCard,
    data: { holdId: hold.id },
  };
});

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
app.listen(8080);
```

The middleware verifies the JWT, parses the body, runs the
matching `ConnectorActionHandler`, and returns the result.
Errors surface as JSON 4xx/5xx; unhandled throws → 500 with
the error message.

## Publishing the Connector

1. **Azure AD app registration.** Single-tenant for org-internal
   deploys, multi-tenant if you'll serve external tenants.
2. **Power Platform → Custom connectors → New custom connector
   → Import an OpenAPI file** — upload your generated
   `connector-manifest.json`.
3. **Test connection** — Power Platform walks you through the
   OAuth flow against the AAD app you registered.
4. **Publish to Copilot Studio** — the connector becomes a
   selectable action source in any Copilot Studio topic.

Public marketplace listing requires Microsoft Partner Center
certification — out of scope for v0.1.

## Per-persona Connectors

Per ADR-042 D5, multi-persona deployments publish one Connector
per persona. The sync step accepts a `personaFilter` and emits
a separate OpenAPI doc per persona — each Connector exposes only
the tools the persona can invoke.

```ts
for (const persona of ['lead-counsel', 'associate', 'paralegal']) {
  const scoped = toolList.filter((t) => persona.canInvoke(t));
  writeFileSync(
    `dist/connector-${persona}.json`,
    JSON.stringify(buildConnectorManifest({ ...opts, tools: scoped })),
  );
}
```

## Specs

26 tests cover the protocol surface:

- `zodToOpenApi`: primitives, length/range refinements, format
  mapping (email/url/uuid), integer detection, enums, arrays,
  objects (required/optional), describe / nullable / default
  passthrough, permissive fallback on unsupported types.
- `buildConnectorManifest`: swagger version, AAD security
  definitions per tenant, one path per tool with the OpenAPI
  schema as the body, supplied `summary` override, agreed
  `ConnectorActionResult` response shape (`message` +
  `adaptiveCard` + `data`), hand-written OpenAPI fragments
  pass through.
- `readConnectorIdentity`: standard AAD claim names, `upn`
  fallback for `preferred_username`, empty defaults.
- `verifyConnectorJwt`: missing header, malformed JWT,
  audience check (both raw + `api://` wrap), tenant whitelist,
  expiry, valid signature (real RSA 2048-bit round-trip).

Run `npm test` from the package directory.

## What this does NOT do

- **No LLM.** Adopters bring their own.
- **No tool registry sync at runtime.** Catalog stays source
  of truth; the build step generates the OpenAPI manifest.
- **No audit fan-in.** When the handler calls the catalog, it
  must pass `origin: 'copilot-studio'` (ADR-041 D3).
- **No Connector publishing automation.** The package emits the
  manifest; pushing it into Power Platform is operational.
- **No Marketplace certification.** Custom Connector / org
  install only in v0.1.

## Status

v0.1.0 — full vertical slice from manifest generation to
request dispatch. Live integration with M365 Copilot deferred
to the adopter's Azure tenant + Power Platform admin steps.
