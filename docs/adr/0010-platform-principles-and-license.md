# ADR-010 · Platform principles, license, and codified non-goals

**Status:** Accepted

**Date:** 2026-05-08

**Context lead-in:** This ADR codifies the strategic + architectural commitments that govern every PR going forward. It is the load-bearing document for the project's open-source platform direction described in [docs/plans/platform-evolution-plan.md](../plans/platform-evolution-plan.md).

---

## Context

After three iterations of the platform-evolution plan (v1: library evolution; v2: open-core + commercial control plane; v3: fully open-source three-tier platform), we settled on the all-open-source three-tier shape. v3 is the chosen direction.

To prevent future PRs from drifting, undermining, or quietly reversing the strategic commitments behind that direction — under commercial pressure, contributor pressure, or simple memory loss — we codify them here. Every commitment listed below is enforceable through PR review (a PR that violates these commitments must be rejected, or an amending ADR must land first).

Three things need to be locked:

1. **The principles** — embedded-first defaults, zero breaking changes — that govern the runtime tier.
2. **The license** — Apache 2.0 across all packages and projects, forever.
3. **The non-goals** — what we will *not* add or do, with explicit reasoning so future contributors don't re-litigate.

Without this ADR, any future PR can quietly add a heavyweight dependency, gate a feature behind a commercial check, or change the license under pressure. With this ADR, doing so requires an explicit amending ADR — a high-friction process that gives the community time to react.

---

## Decision

### D1 — License

**All code in all packages and projects in this repository is licensed under the Apache License, Version 2.0** (`Apache-2.0` SPDX identifier). The full text is in [LICENSE](../../LICENSE).

This applies to:

- `projects/agentic-ui/` (the runtime lib)
- `projects/agentic-ui-server/` (the server-side adapter)
- `projects/agentic-ui-mcp/` (the MCP server adapter)
- All examples under `examples/`
- All scripts under `scripts/`
- Future packages: control-plane services, SDK adapters (Web Components / React / Vue / Svelte / SSR), CLI, community catalog frontend + backend, partner integrations
- All documentation under `docs/`

**No file in any tier is licensed under any other license. No "Enterprise Edition" branch with restrictive terms. No closed-source extensions in the official catalog. No relicensing under BSL, SSPL, AGPL, FSL, or any other "commercial-OSS" variant.**

If a future maintainer needs to relicense (e.g., to comply with a new legal requirement), this ADR must be amended via the standard ADR process, with a 30-day public comment period and TSC supermajority approval. Any unilateral relicensing breaks community trust irrecoverably (see HashiCorp BSL 2023).

### D2 — Three-tier architecture

The project is organized into three tiers, each with distinct responsibilities and license-equal but operationally-distinct delivery vehicles. The tiers are:

| Tier | Scope | Delivery |
|---|---|---|
| **Tier 1 — Runtime** | The lib that adopters embed in their app: `@maverick/agentic-ui` + `agentic-ui-server` + `agentic-ui-mcp` + Native Federation runtime + 15 registries + chat shell + form/workflow/widget renderers + audit chain + telemetry sink | npm packages |
| **Tier 2 — Control plane** | Capability catalog, IAM (OIDC/SAML/SCIM), audit & compliance service, cost & observability service, ops console, multi-tenancy, deploy pipelines | Separate repository, Docker images |
| **Tier 3 — Ecosystem** | Multi-framework SDKs (WC core + React + Vue + Svelte + SSR), `mvk` CLI, community catalog, partner integrations, docs portal, certification program | Mix of npm packages, separate repos, hosted services |

Cross-tier interaction follows two rules:

- **The runtime tier (T1) has zero hard dependency on the control plane (T2) or ecosystem (T3).** It must boot, render, and serve a chat session in a customer's app even if T2 and T3 are unreachable. Any feature requiring T2 must be opt-in via the host's bootstrap, with a no-op fallback.
- **The control plane tier (T2) has zero hard dependency on the ecosystem (T3).** Customers running just T1 + T2 must have a complete platform; T3 components are extensions, not requirements.

The runtime tier is where this ADR's other principles bite hardest. T2 and T3 inherit them directionally (e.g., they should also avoid heavyweight dependencies where possible) but are not bound to the same level of strictness — T2 can use Postgres/Redis as required infrastructure, for example, because it's a server stack, not an embeddable runtime.

### D3 — P1: embedded-first defaults (runtime tier)

**The runtime must run end-to-end in one browser tab with zero external dependencies.**

Concretely:

- No service must be required for the lib to boot.
- Every "provider" / "hook" / "sink" / "adapter" / "store" defaults to an in-process implementation that needs no network.
- Adding an external integration must be a single line in the host's bootstrap (typically `provideX(...)`).
- Adopters must be able to delete every external integration and the lib still works.

This matches the H2-to-Postgres, embedded-Tomcat-to-Kubernetes, local-cache-to-Redis pattern. The default is the embedded one. The optional one runs at scale.

Reviewer test for any T1 PR: "Does this PR force the runtime to depend on something external that wasn't required before?" If yes, the PR must either (a) restructure the change so the external dependency is opt-in via a provider/hook/token, or (b) be rejected.

### D4 — P2: zero breaking changes through v1.x

**Every public API in v1.x stays working forever. No exceptions during this major-version cycle.**

Concretely:

- `inject(ToolRegistry).register(def)` returns a disposer and never goes async.
- `RegistryBase<TDef>` is the abstract base for every registry; the contract doesn't change.
- The 14+ existing injection tokens (`AGENTIC_TELEMETRY_SINK`, `AGENTIC_ACTIVE_PERSONA`, `AGENTIC_APPROVAL_AUDIT_HOOK`, `AGENTIC_OPERATION_AUDIT_HOOK`, `MFE_REGISTRY_SOURCE`, `TOOL_FILTER`, etc.) keep their shapes and semantics.
- `mfes.json` continues to work as a federation manifest source even after we ship REST / GraphQL / control-plane-driven providers.
- Every existing public API in [`projects/agentic-ui/src/public-api.ts`](../../projects/agentic-ui/src/public-api.ts) keeps its signature and behavior.
- Any change that *would* be breaking ships behind a new opt-in API alongside the old one. The old one is deprecated (with a console warning + migration cookbook), but it doesn't get removed during v1.x.

Reviewer test for any T1 PR: "Does this PR change the signature, return type, or behavior of any existing public API?" If yes, the PR must either (a) add the new behavior as a new API alongside the old one, or (b) be rejected.

The major-version bump (v2.x) is explicitly not on the v1 roadmap; it's reserved for a future axis of change (most likely an Angular major-version bump that forces our hand, not platform-evolution work).

### D5 — Codified non-goals

The following are explicitly **not** part of the runtime tier's roadmap and will not be added without an amending ADR + TSC approval. The non-goals exist because each of these would:

- Push the runtime past the "embedded-first" boundary
- Create heavyweight dependencies that operate at scale and slow down boot
- Encourage adopters to lock-in patterns that could be solved more cleanly via injection-token seams

#### Runtime tier (T1) non-goals

- ❌ **Workflow-engine integration** (Temporal, Trigger.dev, Camunda, etc.). The `runUntilSettled` orchestration loop is the runtime's contract. If an adopter needs a workflow engine, they wire it in their tool handlers; we don't bundle the abstraction.
- ❌ **External message-bus integration** (NATS, Kafka, RabbitMQ, NSQ, etc.). `AGENTIC_TELEMETRY_SINK` is the seam for emitting events to external systems. Adopters wire their bus through that token.
- ❌ **Vector-DB / semantic-search integration** (OpenSearch, Pinecone, Weaviate, pgvector at runtime, etc.). The `list().filter(...)` pattern on signal-backed registries serves up to ~200 entries per registry. Beyond that, the control plane (T2) handles capability discovery; the runtime doesn't search.
- ❌ **External policy-engine integration** (OPA, Cedar, Casbin, etc.). `setScopePolicy` plus the closed-AST predicate evaluator covers the runtime's enforcement needs. T2's ABAC compiler is where richer policy lives.
- ❌ **Bundled relational DB.** Adopters wire their own via `ThreadStateStore` (sibling package, opt-in adapters).
- ❌ **Bundled auth provider.** Adopters wire `AGENTIC_ACTIVE_PERSONA` to their identity stack. T2 provides federated identity (OIDC / SAML / SCIM); T1 doesn't.
- ❌ **Bundled SIEM connector.** Adopters wire `AGENTIC_APPROVAL_AUDIT_HOOK` and `AGENTIC_OPERATION_AUDIT_HOOK` to their SIEM. T2 provides SIEM export; T1 doesn't.
- ❌ **Bundled CI/CD.** Out of scope.
- ❌ **Bundled design system.** Out of scope; we extend an existing one in our demos but don't bundle it as a runtime dependency.
- ❌ **Real-time pub/sub for federation.** Signals + SSE-from-T2 is the model. WebSocket/SSE infrastructure isn't in the runtime.

#### Cross-tier non-goals

- ❌ **Closed-source features at any tier.** Every line of code is Apache 2.0. Operational services we run (e.g., a future hosted SaaS) may have closed-source ops scripts; the platform code itself stays open.
- ❌ **License changes** (BSL, SSPL, AGPL, "Elastic License", "Sentry FSL", etc.). D1 is locked; reversal requires an amending ADR + 30-day public comment + TSC supermajority.
- ❌ **Closed-source plugins / capabilities in the official catalog.** Third parties can ship closed-source capabilities under their own license; we don't host them in the official catalog. Separate listings or external links only.
- ❌ **Per-feature commercial gates** in any tier's source code. There is no "Enterprise Edition" branch.
- ❌ **CLA (Contributor License Agreement) requirements.** We use DCO instead — same protection, less contributor friction.
- ❌ **Trademark abuse against forks.** Sentry-style policy (permissive about technical use, strict only about consumer confusion), not Mongo-style.

If a future PR would add any of these, the PR must be rejected and a corresponding amending ADR opened. The ADR process gives the community 30 days of public discussion before the non-goal is loosened.

### D6 — Repo + package layout

T1 lives in this repository. T2 will live in a new repository (`sahassakhare/agentic-platform-control-plane`, public, Apache 2.0). T3 SDKs and CLI live in this repository alongside the runtime; the community catalog and integrations live in their own repositories (`sahassakhare/agentic-catalog`, `sahassakhare/agentic-integrations-*`).

This split:
- Keeps issue/PR streams scoped per tier.
- Allows independent versioning + release cadence.
- Mirrors the Backstage / Grafana / Sentry pattern.
- Reinforces D2's tier separation (cross-tier dependencies become more explicit when crossing repo boundaries).

### D7 — Governance

Documented in [GOVERNANCE.md](../../GOVERNANCE.md). Single-vendor TSC with public RFC process; planned evolution to hybrid TSC at month 12 if external committers materialize, and foundation-track evaluation at year 2.

### D8 — Sustainability

The recommended path documented in [docs/plans/platform-evolution-plan.md](../plans/platform-evolution-plan.md) §6: layered sustainability via sponsorship + services + hosted SaaS. **Specific funding decisions (e.g., starting a hosted SaaS) are not part of this ADR** — they're tactical, not architectural — but the architecture in D2 must support a hosted offering operationally.

---

## Consequences

### Positive

- **Future PRs have a clear bar.** Reviewers can point to specific D-numbers when rejecting incompatible changes.
- **Adopters get a stable contract.** Apache 2.0 forever, embedded-first forever, no breaking changes during v1.x. They can build on us with confidence.
- **Contributors know the rules.** The non-goals list saves them from spending time on PRs that won't merge.
- **Strategy is defensible.** When competitive pressure or commercial-pressure suggests "just relicense" / "add a closed-source feature gate" / "bundle Temporal", this ADR is the answer.

### Negative

- **Less flexibility under pressure.** If a strategic shift is genuinely needed, the ADR amendment process is high-friction (30-day public comment + TSC supermajority). This is intentional, but it does slow down course-correction.
- **Some adopters who'd prefer a commercial vendor relationship may bounce.** Apache 2.0 + community-led growth doesn't suit every enterprise procurement model. We accept this tradeoff per the [v3 plan](../plans/platform-evolution-plan.md) §1.
- **Hosted SaaS revenue is the load-bearing sustainability path.** Without it, the project depends on sponsorship + services. We need to execute on the hosted offering by milestone M5 or revisit.

### Neutral

- The architecture work (T1 R1–R5, T2 catalog/IAM/audit/cost/ops-console, T3 SDKs/CLI/catalog) proceeds the same regardless of D1 (license) and D5 (non-goals). Only the business machinery around it changes.

---

## Alternatives considered

### A1 — Open-core + commercial control plane (v2 of the plan)

Runtime stays Apache 2.0; control plane is closed-source / proprietary; revenue from subscriptions.

**Why rejected (per user directive):** the user committed to all-open-source. Open-core would have provided faster revenue but created a permanent split between OSS adopters and commercial customers, plus the well-known risks of community trust erosion when commercial features pull away from OSS.

### A2 — Library-only (v1 of the plan)

Don't build a control plane or ecosystem at all. Stay as a runtime lib.

**Why rejected:** the user explicitly committed to enterprise-platform direction. Library-only ceded the platform tier to competitors (CopilotKit, Vercel AI SDK, Microsoft Power Platform, Backstage commercial offerings) over the medium term.

### A3 — AGPL or BSL (commercial-OSS license)

Use AGPL or Business Source License to prevent hyperscaler hosting + extract revenue from large commercial users.

**Why rejected:** narrows enterprise adoption (legal-sensitive enterprises sometimes block AGPL); contradicts the all-OSS commitment; risks the same backlash HashiCorp experienced in 2023. Apache 2.0 + speed + community is the alternative defense against hyperscaler clones.

### A4 — Foundation track immediately (CNCF Sandbox at M1)

Move to CNCF or OpenJS governance from day one.

**Why rejected:** project is too young (Sandbox typically requires 6–12 months of public history + a contributor base + adopters). Premature foundation track adds governance overhead without yet earning the corporate-sponsor pool that justifies it. Defer to year 2.

---

## Implementation

This ADR is itself the implementation. The supporting artifacts that codify it operationally are:

- [LICENSE](../../LICENSE) — Apache 2.0 (already in place)
- [CONTRIBUTING.md](../../CONTRIBUTING.md) — DCO sign-off, RFC process, no-CLA policy
- [CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md) — Contributor Covenant 2.1
- [SECURITY.md](../../SECURITY.md) — vulnerability disclosure policy
- [GOVERNANCE.md](../../GOVERNANCE.md) — TSC, decision process, RFC lifecycle
- [MAINTAINERS.md](../../MAINTAINERS.md) — current maintainer roster
- Future ADRs (011–015) for tier-specific architectural decisions per the v3 plan §10 sequence

Subsequent PRs that touch the runtime tier are reviewed against D3 (embedded-first) and D4 (zero breaking changes). PRs that touch licensing, governance, or non-goals require an amending ADR.

---

## References

- [docs/plans/platform-evolution-plan.md](../plans/platform-evolution-plan.md) — v3 platform-evolution plan (the long-form discussion that led to this ADR)
- [ADR-002 — Layered registry system](./0002-layered-registry-system.md) — the original 13-registry decision (now 15)
- [ADR-008 — Registry scope policy](./0008-registry-scope-policy.md) — `setScopePolicy` filter-on-read
- [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) — the chosen license, full text
- [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct.html) — code-of-conduct standard
- [Developer Certificate of Origin](https://developercertificate.org/) — sign-off standard we use instead of CLA
- [HashiCorp BSL announcement August 2023](https://www.hashicorp.com/blog/hashicorp-adopts-business-source-license) — the relicensing event whose community fallout informed our D5 cross-tier non-goal #2
