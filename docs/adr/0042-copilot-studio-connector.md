# ADR-042 — Microsoft Copilot Studio Connector specifics

**Status:** Proposed · **Date:** 2026-05-12 · **Decider:** sahas
**Supersedes:** none · **Related:** ADR-041 (Teams + Copilot
external surfaces — the umbrella contract), ADR-006 (MCP
adapter pattern), ADR-016 (IAM role mapping)

## Context

[ADR-041](./0041-teams-copilot-external-surfaces.md) ratified the
external-surface adapter pattern + three contract additions
(`adaptiveCard` render hint, `origin` audit field,
`provideTeamsContext`). It deferred per-path specifics to ADRs
042+. This ADR records the Path 1c specifics — exposing our
catalog tools to **Microsoft 365 Copilot users** through a
Power Platform **Copilot Studio Connector**.

The other two phases are already implemented:

- **P0** Teams Tab embed (`2c0ec86`)
- **P1** Teams Bot Framework adapter (`18d6d59`)
- **P2** GitHub Copilot Extension webhook (`660f5f5`)

This ADR closes the Microsoft side of the integration plan.
Without it adopters' Microsoft 365 Copilot deployments can't
invoke our tools through enterprise Copilot — they can only see
the agent inside a Teams Tab or as a Teams bot.

Microsoft Copilot Studio (formerly Power Virtual Agents)
exposes tools to Copilot through a custom **Connector** — an
OpenAPI 3 spec + an Azure AD app registration. M365 Copilot
calls the connector with the signed-in user's OAuth bearer; the
connector forwards into our agent server.

## Decision

### D1 — Ship `@maverick/agentic-ui-copilot-studio-connector` as a server-side adapter package

Same shape as `@maverick/agentic-ui-teams-bot` and
`@maverick/agentic-ui-copilot-skill`: protocol + manifest, no
LLM, no Angular dependency. Adopters wire their existing agent
behind a `ConnectorActionHandler`.

The package provides:

- A **Zod-to-OpenAPI 3** translator that walks a tool's input
  schema and emits a Connector-compatible action definition.
- A **manifest builder** that aggregates tool actions into a
  Power Platform Connector OpenAPI document (paths, schemas,
  AAD auth, host info).
- A **JWT verifier** for inbound Connector requests (Azure AD
  v2.0 bearer; audience = the bot's app id; issuer =
  `https://sts.windows.net/{tenant}/`).
- A **request handler** that dispatches actions, runs the
  registered handler, and returns either an Adaptive Card +
  text or a plain JSON result depending on the action's
  response shape.

### D2 — Generate the Connector OpenAPI from Zod tool schemas at build time

Tools are defined with `agenticTool({ name, schema: ZodSchema,
handler })`. The sync step walks the catalog's tools list and:

1. Translates each `ZodSchema` to OpenAPI 3 via
   `zodToOpenApi(schema)`. Subset supported: `z.string`,
   `z.number`, `z.boolean`, `z.enum`, `z.array`, `z.object`,
   `.optional()`, `.describe()`. Unsupported types
   (`z.union`, `z.intersection`, refinements) fall back to
   `additionalProperties: true` with a warning.
2. Emits one **POST** path per tool at `/actions/{toolName}`
   with the OpenAPI schema as the request body.
3. Adds connection settings, OAuth flow URLs, and
   Adaptive-Card-aware response schemas.

The output is a Power Platform-importable OpenAPI doc.
Operators commit this generated file to source and re-run the
sync when tool surfaces change — same lifecycle as
`mfes.template.json`.

**Trade-off:** Zod refinements (`min()`, `email()`, custom
`refine`) don't preserve into OpenAPI's keyword vocabulary
(some do: `minLength`, `format`). Server-side re-validation
is the safety net — never trust Connector-supplied inputs.

### D3 — Authentication: Azure AD v2.0 enterprise app

Connector calls our endpoint with an **OAuth 2.0 bearer**
issued by Azure AD for the signed-in M365 Copilot user. The
adapter's `verifyConnectorJwt`:

1. Reads `Authorization: Bearer <jwt>`.
2. Resolves the AAD signing key from
   `login.microsoftonline.com/common/v2.0/.well-known/openid-configuration`.
3. Validates `aud` against the bot's App Id, `iss` against
   the user's tenant id, `exp` against current time.
4. Returns `{ valid, claims }` — claims carry `tid` (tenant),
   `oid` (object id), `preferred_username` (UPN), `roles`,
   `groups`.

Identity translation → catalog principal works the same way
as the Teams Bot (`tid` → tenant; `oid` → user; `groups` →
roles via the existing `role-mappings` table from ADR-016).

### D4 — Response shape: Adaptive Card + text body

Power Platform Connector responses are JSON. Copilot Studio
renders an Adaptive Card when the response includes one in the
agreed shape:

```json
{
  "message": "Hold issued — HOLD-001 covering 3 custodian(s).",
  "adaptiveCard": { ... }
}
```

The adapter's `respondJson(card, text)` helper produces this
shape. Tools that emit an `adaptiveCard` render hint (ADR-041
D2) pass it through verbatim; tools that don't get the generic
`widgetFallbackCard` from the Teams Bot package (re-exported
here for symmetry).

### D5 — Per-tool action visibility via persona scope

Adopters running multi-persona deployments don't want
M365 Copilot users to see EVERY catalog tool. The sync step
accepts a `personaFilter` that walks `RegistryBase.scopePolicy`
for the active persona and only emits tools the persona can
invoke. Generated manifests are persona-shaped (one per
persona); adopters publish each as a separate Connector.

**Trade-off:** N Connectors instead of one. Manageable for
the small number of personas typical deployments use
(`lead-counsel`, `associate`, `paralegal` — 3-5 personas).
Alternative: a single Connector with a `scope` query param
that the handler honours; rejected because Copilot Studio's
permission model doesn't read query params for action
visibility.

### D6 — No live model embedded; adopters wire their own LLM

Strict mirror of the prior two adapter packages. The
package's `ConnectorActionHandler` is `async (input, identity,
signal) => result`. Adopters run their existing agent loop
inside the handler. The adapter handles the wire format on
both sides.

### D7 — Marketplace listing is optional and out-of-scope

Public Power Platform Connector listings require Microsoft
Partner Center certification + a marketplace submission.
Adopters who want public availability go through that
process; the adapter ships the OpenAPI manifest that the
Partner Center pipeline consumes.

Private / org-internal Connectors (the more common
enterprise deployment) skip the listing and install via
Power Platform's "custom connector → import OpenAPI" flow.

## Alternatives considered

### Alt A — Embed Copilot Studio as the agent runtime; skip our agent server

Reject. We'd lose the catalog's audit chain, tenant
isolation, capability registry, and per-persona scope
policy. The adapter pattern keeps our governance intact.

### Alt B — Use the Microsoft Graph Connectors API instead of Copilot Studio Connectors

Reject. Graph Connectors are for content indexing into M365
search; not the right fit for action-oriented tools.
Copilot Studio Connectors are the documented path for
"M365 Copilot can call this".

### Alt C — Generate the OpenAPI manifest at runtime per request

Reject. Power Platform fetches the manifest once at
Connector import time and caches it. Runtime generation
gives no benefit + complicates the cache-invalidation story.

### Alt D — Skip the Zod-to-OpenAPI translator and require adopters to write OpenAPI by hand

Reject. The catalog already has Zod schemas as the source of
truth. Asking adopters to hand-maintain a parallel OpenAPI
spec is exactly the kind of drift the catalog was built to
prevent.

### Alt E — Adopt `@asteasolutions/zod-to-openapi` as a runtime dep

Reject for now. Our subset is small (≤8 Zod types) and
hand-rolled is ~100 LOC. Adopters already on
`@asteasolutions/zod-to-openapi` for OpenAPI emission can
pass the generated OpenAPI fragment to our manifest builder
directly — the public API takes raw OpenAPI as well as a Zod
schema. Revisit if the subset grows.

## Consequences

**Positive.**

- Closes the Microsoft side of the integration plan; our
  tools reach **every M365 Copilot user**.
- The runtime tier and catalog server stay unchanged.
- Pattern reuses the verify / handler / middleware shape from
  the prior two adapter packages — operators who know one
  know all three.
- Multi-persona scope handled cleanly via per-persona
  Connector publishing.

**Negative.**

- Largest of the four adapter slices — Azure AD app
  registration + admin consent + (optionally) Partner Center
  certification add operational complexity.
- Zod-to-OpenAPI translation has a small lossy surface
  (refinements). Server-side re-validation backstop required.
- Connector caching means manifest changes propagate slowly;
  adopters need a "re-import Connector" step in their release
  flow.
- Schema rotation isn't free — bumping a tool's Zod schema
  requires re-publishing the Connector.

**Neutral.**

- Three contract additions (D2, D3, D4 of ADR-041) all
  honoured. No new lib changes in this ADR.
- Package adds a peer-dep-free ~600 LOC of TypeScript.

## Implementation order

1. Package skeleton + `zod-to-openapi` translator.
2. Manifest builder + verifier + handler middleware.
3. Specs for the translator + verifier + manifest shape.
4. Cookbook walking through Azure AD app registration +
   manifest import + Connector publish in Power Platform.
5. README + ROADMAP + compodoc updates.

All five fit a single commit. P3 is "shipped" once that
commit lands; live deployment + Partner Center listing
remain operational steps per adopter.

## Open questions

1. **Adopter test environment.** Power Platform's Connector
   sandbox requires an M365 dev tenant. We don't run live
   integration tests against it; specs cover the protocol
   layer only.
2. **Connector versioning.** Power Platform supports
   side-by-side connector versions; we should bump the
   manifest's `version` field on every schema-affecting
   change. Defer policy until P3 is in flight.
3. **Pricing for Connector calls.** Each Connector
   invocation counts against M365 Copilot's per-user limit.
   Adopters should monitor usage via the existing usage
   meter (ADR-018) with `origin: 'copilot-studio'`.
4. **Custom Connector vs Certified Connector.** Custom
   Connector is a private org install; Certified is the
   public marketplace path. ADR doesn't pick a side — it's
   per-adopter.
