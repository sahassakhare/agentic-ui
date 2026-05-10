# ADR-033 · provideCatalogCapabilityAuthorizer — catalog-as-allowlist enforcement

**Status:** Accepted

**Date:** 2026-05-10

**Related:** [ADR-011](./0011-registry-provider-hook.md) · [ADR-014](./0014-host-version-compatibility.md) · [ADR-031](./0031-provide-agentic-platform.md) · [ADR-032](./0032-catalog-capability-registrar.md) · [Platform audit 2026-05-10](../audit/2026-05-10-platform-audit.md#gap-3--capability-authorization-catalog-as-allowlist)

---

## Context

The 2026-05-10 platform audit identified **Gap 3 — Capability authorization (catalog-as-allowlist)**:

> Every code-registered capability runs unconditionally. The catalog's `lifecycle: 'disabled'` flag has no enforcement effect on consumer apps — they don't ask. An operator who toggles a capability to `disabled` in the ops console sees no behaviour change in any running app.

Industry comparable: OPA / Cedar / IAM policy decision point. Capability X gated by policy Y is authoritative; the runtime asks before executing.

Without this seam, the ops console's "disable capability" button is decorative — nice for a dashboard, useless for governance. Operators expect that toggling a capability off in the catalog stops the runtime from offering it. Without enforcement, the only ways to disable a tool live are (a) deploy a new app build, or (b) ask the team to push a config change. Neither is "policy."

---

## Decision

### D1 — Read-side filtering via `RegistryBase.setScopePolicy`

The runtime already has a per-registry scope policy (`activeScopePolicy(persona)` + similar). It runs on every `list()` / `get()` / `signal()` read; entries hidden by the policy read as if they weren't registered.

The authorizer **composes** with whatever scope policy the host has installed:

1. On boot, capture the existing policy (`tools.currentScopePolicy()`).
2. Install a wrapping policy that runs **first** the catalog deny-list check, **then** the existing policy. Result: AND of both.
3. The catalog deny-list is signal-driven, so when the live disabled-keys signal changes, the registry's filtered signal recomputes and consumers see the new view immediately (Angular reactivity).

This avoids ADR-011's "no provider hooks on tool/component registries" concern — we're filtering reads, not mirroring writes. The registry's truth stays in-memory; the catalog opines on visibility.

### D2 — Polling, not SSE — for now

The audit asked for "fetches the catalog list at boot + subscribes to SSE for live updates." We ship **polling at 30s** as the v1 transport because:

- Polling has no new infrastructure dependency (the runtime tier doesn't yet have an SSE consumer; the ops console does, but it's tied to its own service).
- Operator toggling-disabled is not a millisecond-level concern. 30s is well below "operator notices the policy change took effect."
- A polling implementation works behind any HTTP proxy / load balancer / service mesh that an enterprise consumer might run; SSE has well-known proxy-buffering pitfalls.
- The service is structured (`fetchDisabled` is a discrete method) so swapping the polling driver for an SSE-driven `applyMutation(event)` later is a single-file change.

`refreshIntervalMs: 0` disables polling — fetch once at boot. Useful in tests and for apps that prefer a manual `service.refresh()` cadence.

### D3 — Default-allow on initial fetch failure

If the catalog is unreachable at boot, two reasonable defaults:

- **`'allow'` (default)** — keep the permissive policy; hide nothing from the catalog (the host's existing scope policy still runs). Degrades gracefully — an offline catalog doesn't break the consumer app.
- **`'deny'`** — install a closed-allowlist policy that hides every entry until a successful fetch lands. Use this when the catalog IS the source of truth and a stale-read is worse than no app surface.

We default to `'allow'` because:

- Adoption story matters: the platform is opt-in. A consumer app that opts in to the authorizer should not break harder than one that didn't opt in.
- The most common real-world failure mode is a transient network blip, not "catalog is permanently down" — the next 30s tick recovers.
- Enterprise apps that demand strict closed-allowlist semantics opt in explicitly via `onInitialFetchFailure: 'deny'`.

The `initialFetchFailed` signal stays `true` until a successful fetch lands, so a "platform-degraded" badge is one inject away.

### D4 — Wired into `provideAgenticPlatform` as a per-feature switch

Following the ADR-031 pattern: `capabilityAuthorizer?: CapabilityAuthorizerFeatureOptions | false`. Feature-options object with `refreshIntervalMs` + `onInitialFetchFailure` knobs; `false` skips the gate entirely; omitted ⇒ skip by default.

### D5 — Public `RegistryBase.currentScopePolicy()` accessor

Composing with the existing policy required reading it. Before this slice, the policy was a private signal — no read accessor.

We add `currentScopePolicy(): RegistryScopePolicy`. It's a thin getter; no behavioural change. The setter is unchanged.

Rationale for the public-API expansion: hosts that want to compose multiple policies (persona + catalog + custom-feature-flag) need to read the existing one. Without an accessor, every composer would have to capture the policy at the moment it set it — fragile across initializer orderings.

### D6 — `onInitialFetchFailure: 'deny'` doesn't apply once a fetch succeeds

The closed-allowlist policy depends on `initialFetchFailed()`, which flips back to `false` on the first successful refresh. Subsequent refresh failures don't re-trigger the closed allowlist. Rationale:

- Once we've seen the disabled-list, we have a non-empty source of truth. Mid-flight failures are transient; flipping to closed-allowlist on every transient failure would be far stricter than operators expect.
- An operator who genuinely wants "deny on staleness > N seconds" can implement it in their own initializer using `lastRefresh` timestamps. We don't bake it in; it's a separate concern from initial-boot behaviour.

---

## Consequences

### Positive

- **The "disable capability" button works.** Operators get real control over what running apps offer; SOC 2 CC7 monitoring requirements get a real enforcement seam.
- **No registry refactor.** Existing scope-policy infrastructure absorbs the new check with one new accessor (`currentScopePolicy()`) and an opt-in composition.
- **Composes with persona policy out of the box.** Hosts that already wire `activeScopePolicy(persona)` keep that, plus get the catalog gate.
- **Default-allow degrades gracefully.** Catalog outage doesn't take down the app; the next refresh tick heals.
- **Symmetric with Gap 1.** The registrar populates the catalog; the authorizer reads from it. Together, they make the catalog a legitimate policy decision point.

### Trade-offs

- **30s polling latency.** Operators see toggle effects within 30s, not instantly. Acceptable for governance; not for realtime authz. SSE-based v2 reduces this to <1s but adds infrastructure complexity.
- **Read-side filter, not call-time gate.** A tool that has already been resolved out of the registry by an in-flight chat run *will* execute even if the catalog disables it mid-flight. We hide it from new resolutions, not from already-resolved invocations. Acceptable for most cases; apps that need strict per-call gating can install a tool-handler middleware (out-of-scope for this slice).
- **No GUI for the disabled list in ops console (yet).** Operators toggle lifecycle on individual capabilities; there's no aggregate "what's disabled" view. The capabilities page already filters by lifecycle, so it's adequate.

### Out-of-scope

- **SSE-based live updates** (v2 transport). Documented as a follow-up. The service is structured to absorb it without consumer-side changes.
- **Per-call middleware that re-checks lifecycle at tool-handler invoke time.** Stricter than scope-policy filtering; useful for "ban this tool right now even mid-conversation" semantics. Separate ADR if/when adopters ask.
- **Catalog-side `lifecycle: 'restricted'` (visible but not invocable).** Today disabled = invisible. Some governance regimes want "visible to admins, invocable by no-one." Out of this slice; a future ADR expands lifecycle states.
- **Per-capability ABAC / OPA integration.** This slice's deny-list is binary (disabled vs visible). Fine-grained policy (rate limits, time-windows, attribute-based) is a separate decision point.

---

## Verification

- `projects/agentic-ui/src/lib/platform/provide-catalog-capability-authorizer.spec.ts` — 7 TestBed tests covering:
  - `composeWithCatalogAuthorizer`: AND-composition with persona, closed-allowlist mode (2 tests).
  - Boot-time hide of disabled entries from registry reads, with auth header + URL shape.
  - Default-allow behaviour when initial fetch fails.
  - `onInitialFetchFailure: 'deny'` closed-allowlist.
  - Live polling: `refreshIntervalMs: 1000` updates the deny-list within one tick.
  - Composes with a persona policy installed before the authorizer's initializer.
- `projects/agentic-ui/src/lib/platform/provide-agentic-platform.spec.ts` — 1 new test verifying `capabilityAuthorizer` switch wires through shared catalogUrl/tenantId/getToken and gates the registry end-to-end.
- `projects/agentic-ui/src/lib/registries/registry-base.ts` — adds public `currentScopePolicy(): RegistryScopePolicy` accessor; existing tests still pass.

## Status snapshot

- Lib tests: 425 → 433 (+8)
- Catalog tests: 165 (unchanged)
- mvk-cli tests: 53 (unchanged)
- ops-console tests: 59 (unchanged)
- **Total: 710/710 passing**
