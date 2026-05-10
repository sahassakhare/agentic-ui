# Semantic search · Agent auto-registration · OPA policy integration · Topology graph upgrade — plan

> **Date prepared**: 2026-05-10
> **Successor to**: [post-audit-followups-plan.md](./post-audit-followups-plan.md) (slices B1 / A2 / A1 / S1 — all shipped on `main`)
> **Status**: Draft — awaiting per-slice approval before any code lands.
> **Approval gate**: Each slice has its own go/no-go. Slices are independent except where flagged.
> **ADR-010 alignment**: [ADR-010](../adr/0010-platform-principles-and-license.md) §D4 declares **"no OPA / OpenSearch / semantic-search / vector-DB in the runtime."** This plan honors that — every piece below is **either server-side (catalog server)** or **an optional plugin package outside the core lib**. Nothing flows into `@maverick/agentic-ui` core.

---

## Four asks, four slices

| # | Slice | Where it lives | Effort | ADR-010 implications |
|---|---|---|---|---|
| **TG** | Topology view: visual graph upgrade (OpenShift-style force-directed) | ops console only | 2–3 days | none — UI only |
| **SEM** | Semantic capability search | catalog server + ops console | 3–4 days | catalog-side; keeps runtime embedded-first |
| **AGT** | Agent auto-registration | catalog server (new table) + new server-side package | 2–3 days | server-side; runtime unchanged |
| **OPA** | OPA policy integration | catalog server (PDP endpoint) + new optional plugin package | 4–5 days | OPA stays *outside* core; opt-in plugin |

Total: **11–15 days**, five mergeable slices (SEM is two — server then UI), each with its own ADR.

> TG was added 2026-05-10 in response to "need visual graphs like OpenShift not only text" feedback. Slice S1 ([ADR-036](../adr/0036-ops-console-topology-view.md)) deliberately shipped as a tree view to ship fast with no graph library; the user wants the visual upgrade. TG is independent of SEM/AGT/OPA — it can ship first and immediately.

---

## Slice TG — Topology view: visual graph upgrade (OpenShift-style)

### Problem

Slice S1 (ADR-036) shipped a **tree view** — nested `<details>` blocks of `tenant → group → kind → capability`. The plan called this out: *"Force-directed can layer on later as a route variant if adopters surface a real 'I need to see edge density' use case."* That ask just landed: visual, not text-only.

The reference is OpenShift's developer-perspective topology view (and similar Argo CD / Cilium Hubble UIs): **nodes as colored shapes, edges showing relationships, force-directed or layered layout, click-to-drill-down**.

### What "visual like OpenShift" actually means

Looking at OpenShift's topology page concretely, the elements that make it useful are:

1. **Node shapes encode kind** — circle = service, hexagon = workload, square = configmap, etc. Colors encode status.
2. **Edges with labels** — "exposes", "binds-to", "owns". Edge thickness can encode strength/weight.
3. **Grouping containers** — visual boxes around related nodes (e.g. all nodes under a single MFE).
4. **Layout** — auto force-directed by default, with an optional grouped/grid layout.
5. **Side panel** — click a node, get full details + actions (start/stop, view logs, edit YAML).
6. **Live updates** — re-layout (or animate) on entity changes.

Mapping to our domain:

| OpenShift concept | Our equivalent |
|---|---|
| Service | Capability (tool / component / form) |
| Workload | MFE remote |
| Group container | Source group (Host-direct or one per MFE) |
| Status colors | Lifecycle (published green / draft amber / deprecated grey / disabled red) |
| Edge labels | "contributes" (MFE → capability), "host-direct" (tenant → capability) |
| Side panel | Capability metadata + lifecycle PATCH button |

### Approach

#### Library choice

Three viable options:

| Library | Bundle | Strengths | Weaknesses |
|---|---|---|---|
| **vis-network** | ~120 KB | Mature; force-directed + layered; node shapes built-in; clustering | Older API; canvas-only (no SVG); animation can stutter at 200+ nodes |
| **Cytoscape.js** | ~150 KB | The "OpenShift-grade" choice; SVG; rich layouts (cose-bilkent, dagre, force); excellent for compound-node grouping | Steeper API; slightly larger |
| **D3-force + custom render** | ~50 KB | Smallest; full control | Have to write everything (drag, zoom, side panel hover, clustering) |

Recommendation: **Cytoscape.js**. The compound-node feature (visual containers around groups) is exactly the OpenShift "group of related workloads" pattern. The +30 KB over vis-network is worth it for the cleaner API and better SVG export.

#### Implementation

- New route `/topology/graph` (keeps the existing tree-view at `/topology` as the default; graph is the alt view). Toggle button on each route to swap.
- `TopologyGraphComponent` — Cytoscape canvas + side panel + filter chips (lifecycle, source).
- Data model: nodes (one per capability + one per MFE + one for tenant), edges (`tenant → host-capabilities`, `mfe → contributed-capabilities`).
- Compound nodes: each MFE remote is a parent compound node, its contributed capabilities are children. Host-direct is its own compound node.
- Layout: `cose-bilkent` (force-directed with compound support) by default. Operator can switch to `concentric` (rings) or `grid` via a layout-picker chip.
- Click capability node → side panel slides in from the right with metadata + lifecycle PATCH button + tags + owner. Same `?focus=<id>` pattern as ADR-036's tree-view.
- Live updates: subscribe to `CatalogStreamService.onMutation`. On mutation, recompute the graph (incremental: add new node, remove deleted, update lifecycle color).
- Filter chips swap the visible subset without re-layout.

#### Visual design

- Node colors encode lifecycle: green/amber/grey/red (matching the existing dot palette).
- Node shape encodes kind: circle = tool, hexagon = component, diamond = form, square = action.
- Compound-node boxes are pale-grey for host-direct, pale-blue for federated MFEs.
- Edges are thin grey by default; edges to disabled capabilities are dashed.
- Selected node + its 1-hop neighborhood highlighted; everything else dimmed.

#### Tests

- 4–5 unit tests for the data-model builder (node/edge shape from `Capability[]` + `MfeRemote[]`).
- 1 integration test that mounts the component and verifies it constructs the right node count + edge count.
- No visual-regression tests in slice 1 (heavy infra; defer).

### Open questions

- **Q-TG-1**: Cytoscape.js vs. vis-network — recommendation: Cytoscape (compound nodes + cleaner API). 30 KB more bundle is fine.
- **Q-TG-2**: Replace the tree view at `/topology` or add `/topology/graph` as an alt route? Recommendation: alt route. Tree view is faster to load + scan-friendly for known-name lookup; graph is for the "what's the shape?" question.
- **Q-TG-3**: Default route — tree or graph? Recommendation: tree default (no jarring change for users who used `/topology` before); add a prominent "switch to graph view" CTA.
- **Q-TG-4**: Layout default — cose-bilkent (force-directed compound) or dagre (layered)? Recommendation: cose-bilkent. Closer to OpenShift's look-and-feel.

### Risks

- **Bundle**: Cytoscape ≈ 150 KB into the **ops-console** (not the runtime lib). Ops-console isn't FESM-budgeted yet but it's worth tracking — current ops-console build is ~200 KB compressed; +150 KB is meaningful but acceptable for a route-lazy chunk.
- **Performance with 500+ nodes**: cose-bilkent layout can be slow (~1 s) for 500 nodes. Mitigation: use `concentric` layout above N=200 (auto-fallback); add a "Recompute layout" button so users don't wait every redraw.
- **Mobile / narrow screens**: force-directed graphs are hostile to <768 px viewports. Mitigation: at small viewports, redirect to the existing tree view. Same data, less ambitious render.

---

## Slice SEM — Semantic capability search

### Problem

Operators searching for capabilities today can filter by `kind`, `lifecycle`, `tag`, or `q` (free-text on name) — a literal substring match. With 50+ capabilities at current scale and 200+ likely as adopters multiply, "find tools that handle eDiscovery" or "what can review documents" needs semantic ranking. The audit's industry scorecard flagged it (Backstage / Cortex have it; we don't).

ROADMAP.md Tier 3 lists semantic search as deferred. Plan-v3 [§"Future of seed-ediscovery.ts"](./platform-evolution-plan.md) calls out semantic search as a control-plane feature (M7). This slice ships the M7 piece **early** because it's small once we commit to pgvector.

### Approach (split into SEM-A and SEM-B)

#### SEM-A — Catalog server: pgvector + embeddings + search endpoint (2 days)

**Decision: Postgres + pgvector**, not OpenSearch / Pinecone / external vector DB.

- pgvector is a Postgres extension (`CREATE EXTENSION vector;`). Already where our data lives. Single-DB stays embedded-first.
- ADR-010 D4 says "no OpenSearch/vector-DB in the runtime" — pgvector lives in the catalog server's existing Postgres, not the runtime, so it's compatible.
- Mature: pgvector is in production at OpenAI, Replit, Anthropic, Supabase. HNSW index, cosine distance.

**Embedding source**: don't bundle a model. Make it pluggable:

```env
EMBEDDING_PROVIDER=openai     # or 'cohere' | 'ollama' | 'noop'
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_API_KEY=...
EMBEDDING_API_URL=...         # for self-hosted Ollama
```

The catalog server reads these on boot. `noop` mode (default for the demo) skips embedding generation entirely; semantic search returns 422 "embeddings not configured." Adopters opt in by setting env vars.

**Schema**:

```sql
ALTER TABLE capabilities ADD COLUMN embedding vector(1536);  -- 1536 = OpenAI dim; configurable
CREATE INDEX capabilities_embedding_idx ON capabilities USING hnsw (embedding vector_cosine_ops);
```

**Pipeline**: on `POST /capabilities`, compute the embedding from `name + description + tags + body` and store. Backfill script for existing rows.

**API**: `GET /v1/catalogs/{tenant}/capabilities/search?q=<query>&kind=<kind>&topK=20`. Returns ranked capabilities with `_score` field. When embeddings disabled: returns 422 problem+json.

**Tests**: integration test against pgvector with the existing testcontainers harness. Stubbed embeddings (deterministic vectors for "review" / "production" / "search" queries) so tests don't need the real API.

#### SEM-B — Ops console: semantic search UI (1–2 days)

- New search-bar at the top of the capabilities page. Falls back to the existing `?q=` substring filter when embeddings not configured (graceful — same UI, less recall).
- Topology page gets a "search" filter chip alongside the lifecycle filter.
- Telemetry: `agentic.platform.search.query` event with topK, latency, result count.

### Open questions

- **Q-SEM-1**: Embedding provider default? OpenAI is the obvious choice (best models, well-known) but creates a paid dependency. Recommendation: ship with `noop` default; document OpenAI + Cohere + Ollama as canonical adapters.
- **Q-SEM-2**: Embedding dim — should we lock to 1536 (OpenAI text-embedding-3-small) or make it configurable? Recommendation: configurable via `EMBEDDING_DIM` env var; default 1536.
- **Q-SEM-3**: Backfill strategy for existing rows? Recommendation: an idempotent CLI command `npm run backfill:embeddings` (skips rows with `embedding IS NOT NULL`).
- **Q-SEM-4**: Semantic search across `mfes` and `audit` tables too, or capabilities-only for slice 1? Recommendation: capabilities only; mfes/audit are scanned linearly today.

### Risks

- **Cost**: ~$0.00002 per capability per re-embed at OpenAI's `text-embedding-3-small`. 1000 capabilities × 1 embed/deploy = $0.02. Negligible for the demo; budget concern at 100k+ capabilities.
- **pgvector install**: requires a Postgres image with the extension. Render's managed Postgres supports it; docker-compose needs to switch to `pgvector/pgvector:pg16` from the stock `postgres:16` image. One-line change.
- **Bundle**: zero impact on lib FESM. Catalog server gains pgvector deps (~1 MB) — server-side only, no concern.

---

## Slice AGT — Agent auto-registration

### Problem

Today the runtime tier wires agent backends (`provideAgUiBackend({url})`, `provideHashbrownBackend(...)`, `provideA2uiBackend(...)`) directly. Operators have no view of "which agent servers are up, which tools each supports, are any down." The catalog has tables for `capabilities`, `mfes`, `tenants`, `usage`, `audit` — but **no agents table**.

When an adopter operates 3 agent servers across staging/prod, knowing what's running where is a real ops problem. Today the only signal is "did the chat shell get a 200 from `/run`."

### Approach

#### Catalog server: new `agents` table + CRUD

```sql
CREATE TABLE agents (
  id            UUID PRIMARY KEY,
  tenant_id     TEXT NOT NULL,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL,    -- 'ag-ui' | 'hashbrown' | 'a2ui' | 'mcp'
  manifest_url  TEXT NOT NULL,    -- e.g. https://agents.example.com/v1/agents/gemini
  capabilities  JSONB NOT NULL DEFAULT '[]',  -- ["bookFlight", "searchDocuments", ...]
  status        TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'degraded' | 'inactive'
  last_health   TIMESTAMPTZ,
  registered_by TEXT NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL,
  -- + RLS + audit + soft-delete columns same as `mfes`/`capabilities`
  CONSTRAINT agents_tenant_name_unique UNIQUE (tenant_id, name)
);
```

REST endpoints: `GET / POST / PATCH / DELETE /v1/catalogs/{tenant}/agents` mirroring the existing MFE patterns. RLS, audit, SSE — all reuse the existing primitives from ADR-027 / ADR-029.

#### New package: `@maverick/agentic-ui-server-registrar`

A small Node-side package that runs **in the agent server's bootstrap** and POSTs registration on startup. Not a new runtime concept; it's the server-side analog of `provideCatalogCapabilityRegistrar`.

```ts
// In your agent server's main.ts:
import { registerAgentWithCatalog } from '@maverick/agentic-ui-server-registrar';

await registerAgentWithCatalog({
  catalogUrl: process.env.CATALOG_URL!,
  tenantId: process.env.TENANT_ID!,
  getToken: () => process.env.CATALOG_TOKEN ?? null,
  agent: {
    name: 'gemini-coordinator',
    kind: 'ag-ui',
    manifestUrl: 'https://agent.example.com/v1/agents/gemini-coordinator/run',
    capabilities: server.toolNames(),  // host's existing tool list
  },
  heartbeatIntervalMs: 30_000,  // catalog status flips to 'degraded' after 2× missed heartbeats
});
```

The package handles:
- Initial POST (idempotent: 409 = "already registered, success", same pattern as ADR-032).
- Periodic heartbeats (PATCH `/agents/{id}` with `status: 'active', lastHealth: now()`).
- Graceful shutdown (PATCH `status: 'inactive'` on SIGTERM).

Lives at `packages/agentic-ui-server-registrar/` — same layout as `@maverick/agentic-ui-server-stores`. Apache 2.0, optional peer dep.

#### Ops console: new `/agents` page

Mirrors the existing `/mfes` page: table of name / kind / manifest URL / status / capabilities / last-health. Sortable, filterable. Topology view picks them up automatically as a fourth group type ("Agent: gemini-coordinator").

### Open questions

- **Q-AGT-1**: Should `agents` reuse the `mfes` table (different `kind`)? Recommendation: separate table — agents have different lifecycle (heartbeat-driven status) than MFE remotes (manifest-driven). Different domains.
- **Q-AGT-2**: Heartbeat as PATCH or a dedicated `POST /agents/{id}/heartbeat`? Recommendation: dedicated endpoint — lighter than PATCH, no audit row per heartbeat.
- **Q-AGT-3**: Should the runtime tier also auto-register the `provideAgUiBackend` it's wired to? Recommendation: NO — registration is a server-side concern (server knows its own URL); browser doesn't.
- **Q-AGT-4**: Demo wiring — should `examples/demo-ediscovery-server` self-register on Render? Recommendation: yes, as a follow-up after slice ships, gated on env var `CATALOG_URL`.

### Risks

- **Heartbeat noise**: 4 agent servers × heartbeats every 30s = 13k heartbeats/day. Not a scale concern at this volume; revisit if adopters run 100+ agents.
- **Dead-agent cleanup**: who marks `status: 'inactive'` when an agent crashes? Catalog can do it via a sweeper job (last_health > 90s ago → inactive). Documented in ADR.
- **Bundle**: new optional package; zero core-lib impact.

---

## Slice OPA — OPA policy integration

### Problem

The current authorizer (ADR-033) gates capabilities by a single binary flag (`lifecycle: 'disabled'`). For real governance, operators want fine-grained rules:

- "Tool `releaseLegalHold` requires persona = `lead-counsel` AND business-hours AND tenant tier ≥ `enterprise`."
- "Tool `runTARClassifier` requires approval from a different persona than the requester."
- "Component `flightCard` is hidden from personas with `vendor.untrusted=true` claim."

Today the host writes Angular code for this (`PersonaService.canInvoke()` in eDiscovery). With OPA, operators write Rego rules in the catalog, and the runtime asks before invoking — no app deploy needed for policy changes.

### ADR-010 D4 carve-out

ADR-010 §D4 says: *"no Temporal/NATS/OPA/OpenSearch in the runtime."* This is non-negotiable for the **core** `@maverick/agentic-ui` package. OPA support therefore ships as:

1. **Server-side**: OPA decision endpoint embedded in the catalog server (or via a sidecar). The catalog already has all the data OPA needs (tenant, capability, role-mappings).
2. **Optional plugin package**: `@maverick/agentic-ui-opa-authorizer` — a separate npm package, optional peer dep, never bundled by the core lib.

### Approach

#### OPA-A — Catalog server: policy bundle storage + decision endpoint (2 days)

- New table `policy_bundles`: `id, tenant_id, name, rego_source, version, created_at, status`. CRUD via REST.
- The catalog ships **OPA Go runtime as a library** (small static binary; we already run a Node server, but the catalog can shell out OR run OPA as a sidecar — see Q-OPA-1).
- New endpoint: `POST /v1/catalogs/{tenant}/policy/decide` — body is `{ subject, resource, action }`, response is `{ allow: boolean, reason?: string, obligations?: ... }`.
- Bundle deploy: operators upload a `.rego` file via UI or `mvk policy publish`. Catalog validates syntax, stores, makes available to the decision endpoint.

#### OPA-B — Runtime plugin: `@maverick/agentic-ui-opa-authorizer` (2–3 days)

Lightweight wrapper over the existing `provideCatalogCapabilityAuthorizer`. Replaces the binary disabled-list with an OPA decision per registry read.

```ts
// In your app.config.ts (after enabling the plugin package):
provideAgenticPlatform({
  catalogUrl: '...',
  tenantId: '...',
  getToken: () => oidc.getAccessToken(),
  capabilityAuthorizer: opaAuthorizer({
    policy: 'production-tools',
    cacheTtlMs: 5_000,           // cache decisions to avoid per-read round-trip
    onDeny: 'hide',              // 'hide' | 'show-greyed-out'
  }),
});
```

Implementation: the plugin's `opaAuthorizer({...})` returns a `CapabilityAuthorizerFeatureOptions`-shaped value. Internally, it batches reads into one decision call per registry-read sweep, caches decisions for `cacheTtlMs`, falls back to default-allow on OPA unreachable.

Two execution modes for the plugin:

1. **Remote mode**: every read calls the catalog's `/policy/decide`. Higher latency, simplest deploy.
2. **WASM mode**: OPA bundle compiled to WASM, runs in-browser via `@open-policy-agent/opa-wasm`. <1ms per decision after a warm-up. Bundle adds ~150 KB. Adopters opt in.

The plugin defaults to remote mode; WASM is opt-in via `mode: 'wasm'`.

### Open questions

- **Q-OPA-1**: OPA in the catalog as a Go binary sidecar (Docker compose adds an `opa` service) or embedded via `node-opa` (npm package)? Recommendation: sidecar — better tested, doesn't require us to track OPA versions in `package.json`.
- **Q-OPA-2**: Rego authoring UX — in-browser editor with syntax highlighting + preview-decision, or just operator-uploads-a-file? Recommendation: file-only for slice 1; in-browser editor if there's adopter pull.
- **Q-OPA-3**: WASM mode default or remote mode default? Recommendation: remote default — embedded WASM is excellent but adds 150 KB to the bundle without explicit consent.
- **Q-OPA-4**: ABAC vs. RBAC scope — should the policy decision include claims-based attributes (time-of-day, IP range, device) or only role/persona? Recommendation: full ABAC — Rego handles either; restricting to RBAC-only is throwing away the headline benefit.

### Risks

- **Policy debugging**: operators write Rego, get unexpected denials. Mitigation: every decision returns `reason` field; ops console gets a "decision log" page.
- **Performance**: WASM mode is fast (sub-ms); remote mode adds 5–20 ms per registry read. Mitigation: cache aggressively in the plugin; invalidate on SSE policy-bundle update.
- **Lock-in concern**: OPA is open-source + foundation-governed (CNCF graduated). Lower lock-in risk than a proprietary policy engine. Mitigation: the plugin's authorizer interface is policy-engine-neutral — Cedar / OpenFGA could ship as alternative plugins.
- **Bundle**: core lib unchanged. OPA plugin is opt-in; WASM mode adds 150 KB only when enabled.

---

## Sequencing recommendation

```
TG (topology graph view)         → ship FIRST — small, ops-console-only, addresses live feedback
SEM-A (catalog pgvector)         → ship after TG
SEM-B (ops console search UI)    → after SEM-A
AGT (agents table + plugin)      → independent of SEM, can interleave with SEM-B
OPA-A (catalog policy + PDP)     → after SEM + AGT (independent code; sequenced for review bandwidth)
OPA-B (runtime plugin)           → after OPA-A
```

Rationale:

- **TG first** — directly addresses the user's "need visual graphs like OpenShift not only text" feedback. UI-only, no migrations, no new infrastructure.
- **SEM next** — unblocks UI-side semantic features (search, recommend-similar). pgvector migration touches Postgres but is contained.
- **AGT in parallel with SEM-B** — separate code surface (server-side table + new package vs. ops-console UI).
- **OPA last** — heaviest; benefits from leveraging SEM (find policy bundles by topic) and AGT (policy decisions reference registered agents).

If preferred, we can ship **TG, SEM, and AGT in parallel** since they don't share code. OPA waits for all three.

---

## Out-of-scope (declared)

- **Bundling an embedding model in the lib** — violates ADR-010 D4 ("no semantic-search/vector-DB in the runtime"). Embedding generation is server-side; query-time embedding generation in the browser is fine but optional.
- **Replacing pgvector with OpenSearch / Elasticsearch / Qdrant** — ADR-010 D4. We stay on Postgres-only.
- **OPA in the runtime core** — same ADR-010 D4 line. OPA stays in the catalog and in an optional plugin.
- **Cedar / OpenFGA as alternatives in this slice** — recognized as future plugins, not built here.
- **Workflow-engine integration (Temporal / Trigger.dev)** — same ADR-010 D4 prohibition; out of scope.
- **Auto-onboarding tenants** when an agent server registers without a known tenant — security risk; tenants stay platform-admin-only.

---

## Approval needed

To proceed with any slice, I need:

1. **Per-slice or batch approval.** Either "ship SEM → AGT → OPA in order" or per-slice gates after seeing each one land.
2. **Answers (or "use your recommendation") to the open questions** under each slice (Q-SEM-1..4, Q-AGT-1..4, Q-OPA-1..4).
3. **Confirmation of the ADR-010 D4 carve-outs**:
   - OPA must stay outside the core lib — agreed?
   - pgvector inside catalog (Postgres extension, not OpenSearch) is acceptable as the vector store — agreed?
   - Embedding generation is configurable + opt-in (`noop` default), not hard-wired to OpenAI — agreed?

Without these answers I default to recommendations and proceed in **the linear sequence above**. Speak up before any slice if you want to redirect.
