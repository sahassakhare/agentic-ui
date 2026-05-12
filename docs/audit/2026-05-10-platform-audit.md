# Platform audit — 2026-05-10

**Scope:** verify the agentic platform meets industry standards as of
commit `745b547` on `main`, and identify the gaps that block consumer
apps (`@infra-tools/agentic-ui` adopters) from integrating end-to-end.

**Method:** read every `src/` directory across `platform/agentic-catalog-server`,
`platform/agentic-ops-console`, `platform/mvk-cli`, `projects/agentic-ui`;
grep for industry-standard primitives (rate limiting, OpenTelemetry,
Helmet, ETag, capability authorizer, metering hook); diff what's
present against what consumer apps need to wire when they pull
`@infra-tools/agentic-ui` and want platform integration.

**Bottom line:**

- Platform tier is **production-shape on data + audit**, **demo-grade
  on observability + security hardening**.
- The runtime↔platform connection is the **weakest seam** — only 2 of
  ~6 needed adapters exist. Consumer apps integrating today reach for
  curl; the platform is "interesting catalog list" not "policy
  decision point + observation layer."

---

## 1. Industry-standard scorecard

Legend: ✅ shipped · ⚠️ partial / has known gaps · ❌ absent

| Category | Status | Notes |
|---|---|---|
| **Auth & AuthZ** | ⚠️ | OIDC ✅, JWT verification ✅, RBAC via roles ✅, `AUTH_MODE=disabled` for demos ✅. **Missing:** API keys for service-to-service, mTLS, fine-grained ABAC, session-flow OIDC redirect (paste-token only) |
| **Multi-tenancy** | ✅ | Postgres RLS on every table ✅, `app.tenant_id` GUC ✅, tenant lifecycle (suspend/activate/soft-delete) ✅, BYPASSRLS for platform-admin ✅ |
| **Audit** | ✅ | Append-only `catalog_audit` ✅, hash-linked chain ✅, JSONL export ✅, server-side `verify` ✅. **Sigstore anchoring deferred** ([ADR-017 §Out-of-scope](../adr/0017-audit-chain.md)) |
| **API design** | ⚠️ | REST + OpenAPI 3.1 ✅, `/v1` versioning ✅, RFC 7807 errors ✅, idempotency on usage POSTs ✅. **Missing:** rate limiting (429 mentioned in error map only — no enforcement), pagination cursors, ETag/If-Match, field selection |
| **Real-time** | ✅ | SSE per tenant ✅, multi-replica via pg LISTEN/NOTIFY ✅ ([ADR-027](../adr/0027-catalog-sse-stream.md), [ADR-029](../adr/0029-multi-replica-sse-pg-listen.md)), polling fallback ✅, heartbeat ✅. No WebSocket / no webhooks (correctly so — SSE is right for this) |
| **Observability** | ❌ | Structured pino logs ✅, X-Request-Id propagation ✅. **Missing:** OpenTelemetry traces, Prometheus `/metrics`, distributed tracing, log shipping config |
| **Reliability** | ⚠️ | Graceful shutdown ✅, /healthz + /readyz ✅, multi-replica ready ✅. **Missing:** circuit breakers on outbound calls, documented retry policies, DLQ for failed events |
| **Security** | ⚠️ | JWT validation ✅, RLS isolation ✅, redacted logs ✅, distroless runtime image ✅. **Missing:** rate limiting, security-headers framework (no CSP / no Helmet — only ad-hoc `X-Frame-Options` etc. on ops-console nginx), CSP, dependency scanning beyond `npm audit`, secrets scanning |
| **Operational** | ⚠️ | Helm chart ✅, docker-compose ✅, Render blueprint ✅, audit-export for SIEM ✅. **Missing:** /metrics, runbooks, alerting templates |
| **Governance / OSS hygiene** | ✅ | Apache 2.0 ✅, CONTRIBUTING + CODE_OF_CONDUCT + SECURITY + GOVERNANCE ✅, 30 ADRs ✅. **Missing:** SBOM generation, Sigstore release signing |

**Net read:** the catalog server is genuinely SOC 2 CC7-ready on the
audit side; the operational side (metrics, traces, alerting) is where
a SOC 2 auditor would file findings.

---

## 2. Consumer-app integration gaps

The runtime tier (`@infra-tools/agentic-ui`) ships **2** adapters that
talk to the platform:

- [`provideCatalogActivePersona`](../../projects/agentic-ui/src/lib/iam/) — IAM persona resolution ([ADR-016](../adr/0016-iam-role-mapping.md))
- [`RestMfeRegistrySource`](../../projects/agentic-ui/src/lib/mfe/rest-mfe-registry.ts) — federated MFE manifest ([ADR-003](../adr/0003-pluggable-mfe-registry-source.md))

**That's it.** Capabilities catalog, usage metering, audit trail of
tool calls, role-mapping protected personas, tenant lifecycle,
real-time stream, governance hooks — all platform features have **no
runtime-tier wiring**. Consumer apps either curl or never integrate.

### Gap 1 — Capability registration

**Today:** Tools/widgets/forms register in code via
`provideAgenticUi({ tools, widgets, forms })`. The catalog has zero
knowledge of what the runtime exposes. The eDiscovery seed
([ADR-025](../adr/0025-ediscovery-demo-seed.md)) papers this over with
a hand-curated mirror — explicitly drift-prone.

**Industry standard:** Backstage, Cortex, Port — all auto-register
entities from running services on boot. AWS Service Catalog
auto-discovers from Lambda / ECS metadata. Code declares; platform
observes.

**Need:** `provideCatalogCapabilityRegistrar({ catalogUrl, getToken,
tenantId })` that on boot iterates registered capabilities and POSTs
each to `/v1/catalogs/{tenant}/capabilities` (idempotent — 409 = OK).

### Gap 2 — Usage metering

**Today:** When a consumer-app tool fires, **nothing reaches the
catalog**. The Usage page in the ops console is always empty for real
workloads; per-tenant quotas have no signal to act on.

**Industry standard:** OpenTelemetry traces wrap every external call.
Stripe-style metering on every billable operation. CloudTrail records
every API call.

**Need:** A runtime instrumentation hook that intercepts every tool
invocation, every LLM call, every MFE fetch and fires `POST
/v1/catalogs/{tenant}/usage` asynchronously (idempotent via
`idempotencyKey`).

### Gap 3 — Capability authorization (catalog-as-allowlist)

**Today:** Every code-registered capability runs unconditionally.
The catalog's `lifecycle: 'disabled'` flag has no enforcement effect on
consumer apps — they don't ask. An operator who toggles a capability
to `disabled` in the ops console sees **no behaviour change** in any
running app.

**Industry standard:** OPA / Cedar / IAM policy decision point.
Capability X gated by policy Y is authoritative; the runtime asks
before executing.

**Need:** `provideCatalogCapabilityAuthorizer({ ... })` that fetches
the catalog list at boot + subscribes to SSE for live updates; gates
every registry's `register()` call. Default-allow (preserves today's
behaviour for non-platform adopters), opt-in for governance.

### Gap 4 — Single configuration point + scaffolding default

**Today:** A consumer app integrating the platform wires 4–5 separate
providers manually:

- `provideCatalogActivePersona({...})`
- `provideRestMfeRegistry({...})`
- (future) `provideCatalogCapabilityRegistrar({...})`
- (future) `provideCatalogCapabilityAuthorizer({...})`
- (future) `provideCatalogUsageMetering({...})`

Plus thread the same `catalogUrl` / `getToken` / `tenantId` through
every one. Four places to keep in sync. `mvk new app` doesn't include
any of this — the scaffold is platform-naive.

**Industry standard:** Spring Boot `@EnableX` annotations.
Stripe SDK's `Stripe.api_key = ...` once. AWS SDK's chained credential
providers.

**Need:** `provideAgenticPlatform({ catalogUrl, getToken, tenantId })`
— single hook that wires every other adapter under the hood. `mvk new
app --with-platform` includes it in the scaffold.

---

## 3. Prioritized recommendations

In **order of leverage** (how much each unblocks):

| # | Slice | Time | Why first / why last |
|---|---|---|---|
| 1 | **Single config point** (Gap 4) | 1 day | Prerequisite. Eliminates 4 separate config-threading PRs in subsequent slices. |
| 2 | **Capability registration** (Gap 1) | 1 day | Closes [ADR-025](../adr/0025-ediscovery-demo-seed.md) drift. Catalog becomes truthful. |
| 3 | **Capability authorization** (Gap 3) | 1 day | Catalog becomes policy decision point. Operators get real control. |
| 4 | **Usage metering** (Gap 2) | 0.5 day | Populates the Usage page with real data. Lower load-bearing but high demo / observability value. |
| 5 | Rate limiting + security headers | 1 day | Catalog server hardening. Helmet middleware, per-tenant token-bucket. |
| 6 | OpenTelemetry traces + `/metrics` | 1 day | Closes the SOC 2 observability gap. |

**Items 1–4 together = ~3.5-day sprint.** Takes the consumer-app
integration story from "two of six adapters wired, the rest is curl"
to **"add one provider line, get the whole platform."**

Items 5 + 6 are platform-tier hardening. Independent of consumer-app
integration; can ship in parallel or after.

---

## 4. Out of scope for this audit

- **Plan v3 milestones M5–M8.** M5 (hosted SaaS GA + SOC 2 Type I) is
  business work, M6 SDKs (WC core / React / Vue) is multi-day work,
  M7 community catalog + signing depends on M5, M8 is foundation
  application work. None affect the present consumer-app integration
  story.
- **The eDiscovery demo's specific runtime↔catalog wiring.** The
  demo currently uses neither `provideCatalogActivePersona` nor
  `RestMfeRegistrySource`. Once the four gap-closers ship, the
  eDiscovery example should be migrated as the reference integration.

---

## Status snapshot at audit time

- Branch: `main` at `745b547` (Merge: activity feed page, ADR-030)
- Tests: catalog 164 + lib 408 + ops-console 59 + mvk-cli 49 = **680/680**
- ADRs: 016–030 (15 ADRs since session start)
- Live: `https://agentic-catalog-server.onrender.com` (catalog) +
  `https://agentic-ops-console.onrender.com` (ops console);
  `AUTH_MODE=disabled` demo deploy with seeded `ediscovery` +
  `demo` + `acme` tenants
