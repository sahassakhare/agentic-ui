# ADR-041 — Teams + Copilot external surfaces (adapter pattern + contract additions)

**Status:** Proposed · **Date:** 2026-05-11 · **Decider:** sahas
**Supersedes:** none · **Related:** ADR-006 (MCP server-side adapter),
ADR-010 (platform principles + license), ADR-016 (IAM role mapping),
ADR-017 (audit chain), ADR-018 (usage meter)

## Context

The agentic-ui platform ships as an Angular runtime tier
(`@infra-tools/agentic-ui`), an opt-in control plane (catalog server,
ops console), and a small ecosystem of backend protocol adapters
(AG-UI, Hashbrown, A2UI). The MCP adapter (ADR-006) already proves
the pattern: **a new "host ecosystem" gets a new adapter package
that translates our internal `AgenticEvent` / `ToolResult` shapes
into the target ecosystem's protocol**, without touching the
runtime tier or the control plane.

Two new host ecosystems are on the integration roadmap, both
asked-for by adopters:

1. **Microsoft Teams** — operators want to live in Teams and have
   the agent respond there (as a bot) or embed the Angular app
   directly (as a Teams Tab).
2. **Copilot agents** — both Microsoft Copilot Studio (MS 365
   Copilot users) and GitHub Copilot Extensions (developers in
   VS Code / JetBrains / github.com) want to invoke our catalog
   tools through their own chat surfaces.

A naive approach would add Teams-specific or Copilot-specific code
paths into the runtime tier or the chat shell. We reject that.
This ADR captures the contract additions + adapter architecture
that lets us add these surfaces additively, preserving ADR-010 D4
(zero breaking changes through v1.x).

The implementation plan lives in
[docs/plans/teams-copilot-integration-plan.md](../plans/teams-copilot-integration-plan.md).
This ADR records only the architectural decisions + the contract
surface every adapter inherits.

## Decision

We adopt the **external-surface adapter** pattern, with three
contract additions to support it.

### D1 — One adapter package per ecosystem; runtime stays canonical

Each new host ecosystem gets its **own npm package** that wraps the
existing `AgenticBackend` interface and translates events both
directions. The Angular chat shell, the 15 registries, and the
catalog server **do not change** to accommodate new ecosystems.

```
@infra-tools/agentic-ui                  (runtime, unchanged)
  ↑                                   AgenticBackend interface
  │                                   ↓
  ├── @infra-tools/agentic-ui-mcp        (ADR-006, ships today)
  ├── @infra-tools/agentic-ui-teams-bot  (new — Path 1b)
  ├── @infra-tools/agentic-ui-copilot-skill (new — Path 2a)
  └── ...future: Slack, Discord, Notion, ServiceNow ...
```

This mirrors how `@infra-tools/agentic-ui-mcp` extends the platform
without touching the runtime — and is the same trade-off ADR-006
already weighed and ratified. Doing the same for Teams + Copilot
keeps the runtime tier's surface frozen and the platform
guarantee (D4) intact.

**Consequences.**
- Adding a new ecosystem is purely additive — new package, no
  edits to existing packages.
- Each adapter is independently versioned and released.
- Adapter authors must keep up with their ecosystem's wire
  format changes (Adaptive Card schema bumps, Copilot Extension
  protocol revisions) without library churn.

### D2 — Add `adaptiveCard?: object` to `ToolResultRenderHints`

Tools that want to render natively inside Teams / Microsoft
Copilot Studio emit an Adaptive Card schema alongside the existing
`components`, `markdown`, `image_url`, and `html` hints. The chat
shell ignores `adaptiveCard`; the Teams Bot adapter (Path 1b) and
the Copilot Studio Connector (Path 1c) use it as the highest-
fidelity render. Mirrors the existing `html` hint added for MCP
UI in ADR-006.

```ts
// projects/agentic-ui/src/lib/types/tool-result.ts
export interface ToolResultRenderHints {
  readonly components?: ReadonlyArray<{ name: string; props: unknown }>;
  readonly markdown?: string;
  readonly image_url?: string;
  readonly html?: string;
  readonly adaptiveCard?: object;   // ← NEW, optional
  readonly iframe_url?: string;
}
```

Fully optional; every existing tool stays valid. Adapters that
don't recognise the field skip it and fall back to the next
hint in their preference order.

**Consequences.**
- Additive type change; no migration burden.
- Tools may choose to maintain hand-written AC schemas for their
  Teams / Copilot rendering, or rely on the generic fallback (a
  fact set + deep-link card).
- Generic fallback lives in the adapter, not in the lib; tools
  that want pixel-perfect Teams cards opt in.

### D3 — Add `origin: string` to audit events

Every audit row should record which surface produced the
mutation, so the ops console activity feed (ADR-030) can filter
by surface and operators have a defensible trail across channels.

```ts
// platform/agentic-catalog-server/src/repository/audit-repo.ts
export interface AuditAppendInput {
  readonly tenantId: string;
  readonly actor: string;
  readonly origin: string;  // ← NEW: 'web', 'teams-bot', 'copilot-skill', 'mcp', ...
  readonly requestId: string | null;
  readonly operation: AuditOperation;
  readonly entityType: string;
  readonly entityId: string;
  readonly diff: Record<string, unknown> | null;
}
```

Default is `'web'` for unspecified callers (matches today's
behaviour). Each adapter sets `origin` to its own identifier when
calling the catalog audit endpoint. The `catalog_audit` table
gets an `origin TEXT NOT NULL DEFAULT 'web'` column via a new
migration; the chainHash computation includes `origin` so the
chain stays tamper-evident.

**Consequences.**
- Activity feed can faceted-filter by origin.
- Single-row migration on `catalog_audit`; default keeps existing
  rows valid.
- chainHash recomputation: existing rows' hashes were computed
  without `origin`. We treat any null/missing `origin` as `'web'`
  in the verifier so chain integrity holds across the rollout.

### D4 — Add `provideTeamsContext()` factory in `/lib/platform`

For Path 1a (Teams Tab embed), a thin factory reads
`microsoft-teams-js` SDK context (tenantId, userPrincipalName,
theme, etc.) at boot and bridges it into the existing IAM persona
resolver from ADR-016. Lives in the runtime tier because every
Teams-Tab host needs it; not pulled into a separate package.

```ts
// projects/agentic-ui/src/lib/platform/provide-teams-context.ts (new)
export function provideTeamsContext(): Provider[] { ... }
```

Tree-shakeable; only included when adopters import it.

**Consequences.**
- New optional dependency on `@microsoft/teams-js@2`
  (peerDependency, not bundled).
- One new public symbol per ADR-010's stability contract;
  documented in `docs/architecture/platform-seams.md`.

### D5 — No changes to the chat shell or any registry

The chat shell stays Angular-only. The 15 registries stay as-is.
Adapters never reach into either. Tools register once via the
existing `ToolRegistry` and run through the existing
`AgenticBackend.run(...)` path; the adapter wraps both ends of
that, translating events.

This is the most important architectural commitment: **the
runtime tier is the substrate**, adapters are the surfaces. We
will not let surface-specific code creep into the runtime tier.

### D6 — Each adapter writes its own auth + persona resolver

Every external ecosystem has a different identity model:

- Teams Tab + Bot: AAD `tenantId` + `userPrincipalName`
- Copilot Studio: Azure AD app registration claims
- GitHub Copilot Extension: GitHub App installation id + user
  login + repo / org / enterprise scope

The catalog already supports JWT-claim-based role mapping
(ADR-016). Each adapter parses its own identity source, maps to
the catalog's principal shape, and never bypasses the catalog's
RLS or persona scope policy. Adapters are responsible for their
own token validation; the catalog re-validates server-side.

**Consequences.**
- Adopters running multiple surfaces need claim-translation
  configuration per surface.
- Single audit identity across surfaces — every audit row's
  `actor` field is the catalog principal, not the surface-
  specific user id.

### D7 — Adaptive Card schema version is per-adapter, not lib-wide

Microsoft pushes new Adaptive Card schema versions periodically
(1.4 → 1.5 → 1.6). Pinning a single version in the lib would
freeze every adapter; pinning per-adapter lets Teams Bot ship at
AC 1.5 today and Microsoft Copilot Studio bump to 1.6 later as
M365 clients support it. The `adaptiveCard` field on
`ToolResultRenderHints` is typed as `object` (not a specific AC
schema type) precisely so each adapter can carry the version
that suits its target host.

**Consequences.**
- No central AC type definitions to keep current.
- Tools that hand-write `adaptiveCard` payloads pick their own
  schema version + accept the rendering risk.
- Adapter docs list the AC version supported.

## Alternatives considered

### Alt A — Fork the chat shell per ecosystem

Reject. Would create 4+ divergent Angular codebases (one per
host) with no ability to share bug fixes, drift in tool behaviour,
and an n×m matrix for QA. ADR-010 D4 explicitly forbids this kind
of fragmentation.

### Alt B — Replace `<mvk-chat-shell>` with a Teams-native chat in Teams contexts

Reject. The chat shell is the canonical Angular surface and an
adopter target on its own. Replacing it inside Teams would mean
maintaining two implementations of the orchestration loop
(`runUntilSettled`). The Teams Bot adapter (Path 1b) wraps the
existing loop instead — same orchestrator, different I/O
surface.

### Alt C — Make `adaptiveCard` a top-level field on `ToolResult` (not a render hint)

Reject. Render hints (`components`, `markdown`, `html`,
`image_url`, `adaptiveCard`) belong together as a single
"how-to-render" cluster. Pulling `adaptiveCard` to the top
level would split the cluster across two surfaces and create
ambiguous resolution rules. The MCP adapter already established
the render-hint cluster pattern (ADR-006).

### Alt D — Use OpenAI Functions / a single shared schema instead of multiple connector schemas

Reject. Each ecosystem (Copilot Studio Connectors, GitHub
Copilot Extensions, MCP) has its own tool-schema dialect.
Converting our Zod schemas to each at the adapter boundary is
the right place for the translation; trying to ship one
canonical schema would compromise on every ecosystem
simultaneously.

### Alt E — Embed the agent inside Microsoft Copilot's own LLM runtime (no separate server)

Reject. We'd lose the catalog's audit chain, tenant isolation,
and capability registry — these are platform-level guarantees
the demo + production deployments rely on. Running our tools as
Connector actions against our own server preserves the chain;
running them inside Copilot's runtime loses it.

## Consequences

**Positive.**

- Adapters land as additive packages; no breaking changes.
- Runtime tier's public surface stays frozen per ADR-010 D4.
- Tools authored once work across every surface (with fidelity
  trade-offs per surface — documented in the integration plan's
  fidelity matrix).
- Audit chain integrity preserved across surfaces via the
  `origin` field.
- Pattern scales: future Slack / Discord / Notion adapters
  follow the same shape.

**Negative.**

- Each new adapter is a real engineering effort (2–6 weeks
  depending on ecosystem complexity).
- Adapter authors must keep up with their ecosystem's protocol
  churn; some platforms (Microsoft) ship breaking changes
  quarterly.
- Generative UI degrades to Adaptive Cards or plain markdown
  outside the Angular surface; rich F1 composition + F3
  workflows need either hand-AC mappers or a Teams Tab deep-link
  fallback.
- Identity translation per surface adds operational complexity
  (different OAuth flows, different JWT shapes).

**Neutral.**

- Three contract additions (D2, D3, D4). All additive. ADR-010
  D4 honoured.
- New migration on `catalog_audit` for the `origin` column. Default
  value keeps existing rows valid.

## Implementation order

Per the integration plan
([teams-copilot-integration-plan.md](../plans/teams-copilot-integration-plan.md)):

1. **P0** — Teams Tab embed (Path 1a). No package work; just
   manifest + `provideTeamsContext()`. 1 week.
2. **P1** — `@infra-tools/agentic-ui-teams-bot` (Path 1b). 3 weeks.
3. **P2** — `@infra-tools/agentic-ui-copilot-skill` (Path 2a). 2
   weeks.
4. **P3** — Microsoft Copilot Studio Connector (Path 1c). 5–6
   weeks. ADR-042 will cover specifics.
5. **P4** — GitHub Copilot Workspace custom agent (Path 2b).
   Deferred pending Workspace API maturity.

P0 + P2 = 3 weeks total and unlocks both ecosystems at
demo-grade quality. Recommended starting point.

## Open questions

1. **Adopter target.** Teams-first vs GitHub-first vs
   Enterprise-first changes the phase order. Captured as a
   decision-needed item in the integration plan §10.
2. **Per-tool AC mapper effort.** Hand-AC'ing every catalog tool
   has linear cost; the generic fallback covers tools that don't
   opt in. Do we budget for hand mappers on the F4 + F5 tools
   (approvals + long-running) only, or all 22? Defer decision
   until P1 in flight.
3. **Marketplace publishing.** Should we list the
   `agentic-ui-copilot-skill` on the GitHub Marketplace? Public
   listing reaches more devs but adds compliance + security
   review overhead. Defer.
4. **Cost model.** When two surfaces are live, per-tenant LLM
   costs double-or-more. The existing usage-meter (ADR-018)
   tracks invocations; the adapter sets `origin` so the host
   can enforce per-surface quotas. Quota policy itself is out of
   scope for this ADR.
5. **AC schema versioning.** D7 punts this to per-adapter. If
   adopters need a tested cross-adapter baseline, we'd need a
   companion ADR that pins versions per adapter. Deferred until
   we have ≥2 adapters in flight.
6. **GitHub Copilot Workspace.** Path 2b deferred pending
   Workspace API maturity. Revisit in 2026-Q4 after GitHub's
   announced extensibility surface ships.

## Notes for reviewers

- This ADR ratifies the **contract surface** only — the new
  packages and their internals are covered by per-path ADRs
  (042+) drafted alongside each phase.
- D2's `adaptiveCard` field is the only addition to a public
  type in the runtime tier. ADR-010 D4 zero-breaking-changes
  contract is honoured: existing tools and adopters see no
  change.
- D3's audit migration is non-trivial (adds a column with
  default + extends chainHash) but is additive at the row
  level. Migration 010 (or whichever number is next when this
  ADR is implemented) will encode it.
