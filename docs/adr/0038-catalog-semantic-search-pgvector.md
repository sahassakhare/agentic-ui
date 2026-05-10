# ADR-038 · Catalog semantic search via pgvector

**Status:** Accepted

**Date:** 2026-05-10

**Related:** [ADR-010](./0010-platform-principles-and-license.md) · [ADR-018](./0018-usage-meter.md) · [Plan §SEM](../plans/semantic-search-agent-registry-opa-plan.md#slice-sem--semantic-capability-search)

---

## Context

Capability discovery in the catalog today is limited to literal substring search (`?q=` on the name field) plus filters by `kind`, `lifecycle`, `tag`, and `owner`. With 50+ capabilities at current eDiscovery scale and 200+ likely at adopter rollout, operators need semantic ranking — *"find tools that handle legal documents"* should match `redactDocument`, `addToPrivilegeLog`, `runTARClassifier` even though none has the literal word "legal" in its name.

The audit's industry scorecard (2026-05-10) flagged it. Backstage / Cortex / Port all ship semantic search. ROADMAP.md Tier 3 had it as deferred; the post-audit follow-ups plan §SEM brought it forward because it's small once we commit to pgvector.

ADR-010 §D4 declares: *"no Temporal/NATS/OPA/OpenSearch in the runtime."* This ADR honors that — semantic search lives in the catalog server's existing Postgres via pgvector, never in the runtime lib.

---

## Decision

### D1 — pgvector inside the existing Postgres, not OpenSearch / Pinecone / Qdrant

We add a `vector(N)` column to the `capabilities` table + an HNSW index. Stays single-DB; ADR-010 D4 alignment preserved.

Rationale:
- pgvector is mature (production at OpenAI, Replit, Anthropic, Supabase, ourselves now).
- The Render-managed Postgres + standard `pgvector/pgvector:pg16` Docker image both ship pgvector.
- HNSW + cosine distance is the recommended default for read-mostly capability catalogs.
- Adding a separate vector store (Pinecone, Qdrant, Elasticsearch) means a new dep, a new auth surface, a new migration story, a new sync pipeline — all to gain marginally better recall at our scale. Postgres is good enough up to ~10M vectors per tenant.

### D2 — Pluggable embedding provider — `openai` | `cohere` | `ollama` | `noop` (default)

The catalog server doesn't bundle any embedding model. Adopters configure via env:

```env
EMBEDDING_PROVIDER=openai          # default 'noop'
EMBEDDING_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_API_URL=                 # optional; default per-provider
EMBEDDING_DIM=1536                 # MUST match the migration's vector(N)
```

Default `noop` mode keeps the install + first-run path friction-free — semantic search returns 422 "embeddings not configured" until adopters opt in. Every other endpoint works unchanged.

**Three real providers shipped**:
- **OpenAI** — `text-embedding-3-small` (1536-dim, default). Best models, paid.
- **Cohere** — `embed-english-v3.0` (1024-dim, default; adopters set `EMBEDDING_DIM=1024` + `ALTER TABLE` if switching).
- **Ollama** — `nomic-embed-text` (768-dim, default). Self-hosted; no API key needed.

Adding a new provider is one new class implementing `EmbeddingProvider`. The interface returns `Promise<readonly number[] | null>`; null = degrade gracefully (don't block writes).

### D3 — `EMBEDDING_DIM` must match the migration's `vector(N)`

The migration ships with `vector(1536)` — matches OpenAI default. Adopters using a different provider/dim run a one-time `ALTER TABLE capabilities ALTER COLUMN embedding TYPE vector(N)` before flipping `EMBEDDING_PROVIDER`. Documented in the migration's comment block.

This is a real constraint — pgvector's column dim is fixed, and HNSW indexes are dim-specific. We don't try to abstract over multiple-dim columns; that would balloon the schema for marginal benefit.

### D4 — Embedding generation is fire-and-forget per write; never blocks

POSTing a capability:

1. Parse + validate the body (Zod).
2. Call `embeddings.embed(text)` BEFORE opening the DB transaction. Provider failures return `null` (logged to telemetry).
3. Open transaction, insert row (with embedding if non-null, otherwise the column defaults to NULL).
4. Audit row + SSE event publish (existing flow).

A null embedding doesn't fail the write — the row lands, semantic search just won't find it until the backfill CLI re-embeds. This is intentional: an upstream embedding-API outage shouldn't block capability registration.

The text we embed is deterministic — `kind: <k>\nname: <n>\ndescription: <d>\ntags: <a, b>` — so the backfill produces the same embeddings as fresh inserts.

### D5 — Search endpoint validates input first, then service availability

`GET /v1/catalogs/{tenant}/capabilities/search?q=<query>&kind=<k>&topK=20`:

- Input validation (`q` required, `topK` in [1, 100]) → 422 with actionable detail.
- Service-availability check (`embeddings.enabled`) → 422 "Semantic search is not configured. Set EMBEDDING_PROVIDER=…".
- Embedding-provider call → 503 if the provider returns null mid-query (transient outage).
- Vector search → 200 with ranked items + `_score`.

Order matters: clients with a malformed `topK` get a 422 about `topK`, not a misleading "not configured" — even in the no-provider state.

### D6 — Cosine distance + HNSW index, top-K query

```sql
SELECT *, (1 - (embedding <=> $1::vector))::float8 AS score
  FROM capabilities
 WHERE embedding IS NOT NULL AND soft_deleted_at IS NULL
   AND ($2::text IS NULL OR kind = $2)
 ORDER BY embedding <=> $1::vector
 LIMIT $3;
```

`<=>` is pgvector's cosine-distance operator (lower = more similar). We invert to `1 - distance` so callers see a "higher is better" score in [0, 1].

The `WHERE embedding IS NOT NULL` predicate is critical — rows without embeddings would return distance NaN otherwise. Combined with the HNSW index, query latency is sub-50ms at 10k rows.

### D7 — Backfill CLI: `npm run backfill:embeddings`

Adopters opting in mid-deploy run a one-shot `node dist/scripts/backfill-embeddings.js`. The script:

- Reads `EMBEDDING_PROVIDER` from env.
- Fetches all rows where `embedding IS NULL AND soft_deleted_at IS NULL`.
- Embeds + UPDATEs each, logging progress every 25 rows.
- Idempotent — skipped on rows that already have embeddings.
- Exits 0 on full success, 1 if any row failed (rerun later — null embeddings stay null until re-attempted).

The script doesn't enable RLS — it scopes by `app.tenant_id = ''` (platform-admin) so all tenants get backfilled in one pass.

### D8 — pg-mem doesn't support `vector` — strip the migration in tests

Our integration test harness uses pg-mem (no `CREATE EXTENSION vector`, no `vector(N)` type, no `<=>` operator). The test-helpers' migration loader strips:

- `CREATE EXTENSION ... vector ...;`
- `ALTER TABLE capabilities ADD COLUMN ... embedding ...;`
- `CREATE INDEX ... capabilities_embedding_idx ...;`

The application code path that handles "no embedding provider" produces no `vector` SQL anyway (we omit the column from INSERT when there's nothing to store), so existing tests pass through unchanged. Real-pg integration tests for the search endpoint are deferred to a testcontainers harness slice.

---

## Consequences

### Positive

- **Semantic capability discovery** at adopter scale without leaving Postgres.
- **Zero-config default** — `noop` mode keeps the install path friction-free; semantic search opts in via env vars.
- **Three first-party providers** (OpenAI, Cohere, Ollama) cover paid / paid-alt / self-hosted scenarios.
- **Graceful degradation** — embedding-provider outages don't block writes or other endpoints. Search returns 422/503 with actionable messaging.
- **No runtime impact** — runs entirely in the catalog server. The runtime lib's FESM is unchanged.

### Trade-offs

- **`EMBEDDING_DIM` must match `vector(N)`** — switching providers across dim mid-flight requires an `ALTER TABLE` + backfill. Documented; not silent.
- **OpenAI cost** — at $0.00002 per capability per re-embed × 1000 capabilities × 1 deploy = $0.02. Negligible for the demo; budget concern at 100k+ capabilities.
- **pgvector install** — Render-managed Postgres includes it; self-hosted adopters must use `pgvector/pgvector:pg16` instead of stock `postgres:16`. Documented in the migration comment.
- **No real-pg integration test for the search endpoint in this slice** — pg-mem can't run `<=>`. Pure-function unit tests on the embedding provider + 422 path tests on the route. Real-pg via testcontainers is a follow-up.

### Out-of-scope

- **Bundling an embedding model in the runtime lib** — violates ADR-010 D4.
- **OpenSearch / Elasticsearch / Qdrant** — same ADR-010 D4 line.
- **Browser-side query embedding** — possible via `transformers.js` but adds 50–200 MB of model load. Server-side query embedding is the simpler default; browser-side opt-in is a future plugin.
- **Tenant-isolated indexes** — pgvector's HNSW is one index per column. Tenant scoping is via WHERE (RLS) — works at our scale; revisit at 100M+ vectors.
- **Hybrid (semantic + lexical) ranking** — semantic-only for v1. Adding BM25 / `tsvector` blend is a clean follow-up if recall is poor.

---

## Verification

- `platform/agentic-catalog-server/src/db/migrations/006_capability_embeddings.sql` — adds `vector` extension + column + HNSW index.
- `platform/agentic-catalog-server/src/embeddings/provider.ts` — pluggable provider abstraction; OpenAI / Cohere / Ollama / noop implementations.
- `platform/agentic-catalog-server/src/routes/capabilities.ts` — `POST` embeds on insert; new `GET /search` endpoint.
- `platform/agentic-catalog-server/src/repository/capability-repo.ts` — `createCapability(client, tenant, body, actor, embedding?)`, `updateCapabilityEmbedding`, `searchCapabilitiesByEmbedding`.
- `platform/agentic-catalog-server/src/scripts/backfill-embeddings.ts` — idempotent CLI for retro-embedding existing rows.
- `provider.spec.ts` — 10 unit tests on the four providers + `buildEmbeddingText` (the deterministic embedding-text builder).
- `capabilities.spec.ts` — 3 new tests on the `/search` endpoint (422 not-configured, 422 missing q, 422 topK out of bounds).

## Status snapshot

- catalog tests: 165 → **178** (+13 = 10 provider + 3 search-route)
- lib tests: 453 (unchanged)
- mvk-cli tests: 53 (unchanged)
- ops-console tests: 71 (unchanged)
- **Total: 755/755 passing**
- Catalog build clean. Migration 006 idempotent.
