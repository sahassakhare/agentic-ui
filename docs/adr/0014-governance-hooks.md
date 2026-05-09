# ADR-014 · Governance hooks — `requiredHostVersion`, tags, owner, lifecycle

**Status:** Accepted

**Date:** 2026-05-09

**Related:** [ADR-002](./0002-layered-registry-system.md) · [ADR-010](./0010-platform-principles-and-license.md) · [ADR-011](./0011-registry-provider-hook.md)

---

## Context

The 15 registries hold reasonably-typed entries today, but they're missing a small set of governance fields that production deployments quietly need:

- **Compatibility constraint** — a federated remote should be able to declare "I require host @maverick/agentic-ui ^1.0.0" so the host can refuse incompatible registrations cleanly instead of crashing on the next call.
- **Catalog metadata** — a future control-plane catalog (Tier 2 in the v3 plan) wants `tags`, `owner`, `lifecycle` on every capability for filtering, attribution, and deprecation.

Two of v3 plan §4.1 R5's deliverables (`conflictPolicy` + `onDispose`) were *already shipped* before this ADR was written — they showed up in earlier work without being formalized as a milestone deliverable. This ADR completes R5 by adding the remaining four: `requiredHostVersion`, `tags`, `owner`, `lifecycle`.

---

## Decision

### D1 — Four optional fields on `RegistryEntry`

```ts
interface RegistryEntry {
  // (existing) name, source, scopes, onDispose
  readonly requiredHostVersion?: string;
  readonly tags?: readonly string[];
  readonly owner?: string;
  readonly lifecycle?: 'draft' | 'published' | 'deprecated' | 'disabled';
}
```

All four are **optional**. Hosts and remotes that don't supply them see no behavior change — the runtime treats absence as "no opinion" everywhere.

### D2 — `requiredHostVersion` is enforced at `register()`

When set, `RegistryBase.register()` evaluates the range against the lib's compile-time `LIB_VERSION` constant. On mismatch:

- Registration is **skipped silently** (no throw).
- A telemetry event `agentic.registry.host_version_mismatch` is emitted with the entry name + source + required version + host version. Operators monitor this in their pipeline.
- The disposer returned to the caller is a **no-op** (so federated remotes can call it on unload without conditional logic).

This is the right behavior for federated remotes: a remote pinned to v2 loaded into a v1 host should silently decline to surface its tools, not crash the host. The remote can also call `requiredHostVersion` purely as catalog metadata (without expecting enforcement) by using a range that matches every version the lib will ever ship — though that's pointless.

### D3 — Minimal inline semver matcher (no `semver` dep)

`satisfies(version, range)` in [`projects/agentic-ui/src/lib/registries/semver-match.ts`](../../projects/agentic-ui/src/lib/registries/semver-match.ts) supports the realistic subset:

| Range | Meaning |
|---|---|
| `1.2.3` / `=1.2.3` | exact match |
| `^1.2.3` | major same; version >= target |
| `~1.2.3` | major+minor same; patch >= target |
| `>=1.2.3`, `>1.2.3`, `<=1.2.3`, `<1.2.3` | comparison operators |

**Not supported** (returns `false` to fail-safe):
- Compound ranges (`>=1.2.3 <2.0.0`)
- Alternation (`^1 || ^2`)
- x-ranges (`1.x`, `1.2.x`)
- Pre-release / build metadata (`1.2.3-beta`, `1.2.3+build`)
- Two-part versions (`1.2`, `~1.2`)

The `semver` npm package would handle all of these, but it's ~50KB minified — a meaningful fraction of our FESM budget. The supported subset above covers every realistic federated-remote / capability-catalog use case for the v1.x lifetime. If we ever need richer matching, we can either bundle `semver` or extend the inline matcher; both are forward-compatible additions.

### D4 — `tags`, `owner`, `lifecycle` are opaque to the runtime

`tags` (free-form catalog tags), `owner` (responsible team / individual identifier), and `lifecycle` (`'draft'` / `'published'` / `'deprecated'` / `'disabled'`) are **stored, never enforced** by the runtime. Their value is for:

- The future Tier 2 control-plane catalog (capability discovery + filtering).
- Persona scope policies that want to hide deprecated entries from production personas (`policy.scopes ⊃ {'deprecated'}` → filter).
- Telemetry filters + dashboards.
- Operator visibility (the catalog UI surfaces them).

`lifecycle: 'disabled'` is **not** automatically filtered — that's a scope-policy decision the host makes. Some hosts may want to keep disabled entries listed-but-greyed in admin UIs; others want them invisible. Don't pre-decide.

### D5 — `LIB_VERSION` is a hardcoded constant, sync on release

`projects/agentic-ui/src/lib/version.ts` exports a `LIB_VERSION = '1.1.0'` constant. Release tooling bumps it in lockstep with `projects/agentic-ui/package.json`. Reasons we don't import from `package.json` directly:

- Native Federation + the Angular package compiler don't agree on JSON imports across all bundler configurations.
- A constant is portable; readers don't have to chase a JSON path.
- A single point-of-change at release is auditable.

This is brittle in the abstract (humans can forget to bump). In practice, the release script (which is what bumps `package.json`) edits both files together. A CI lint check that the two values match is straightforward to add later if the manual sync fails once.

---

## Consequences

### Positive

- **Federated remotes get a clean compatibility story.** A remote shipped at v2 loaded into a v1 host now silently skips its v2-only capabilities instead of crashing the chat.
- **Catalog metadata exists.** Tier 2 (control plane) work can populate + read these fields without renegotiating the type.
- **Backwards-compatible.** All four fields are optional. Existing code unchanged.
- **No new dependency.** Inline semver matcher avoids pulling `semver` into the runtime bundle.
- **Telemetry-observable.** Version-mismatch skips fire `agentic.registry.host_version_mismatch`; ops teams see them in dashboards.

### Negative

- **Inline semver subset is exactly that — a subset.** Compound ranges fail to `false` instead of being parsed. Documented in §D3. Most consumers won't care; rare cases get a clear "didn't match" instead of a silent surprise.
- **`LIB_VERSION` requires manual sync.** Until we have a CI lint, a forgotten bump produces version-mismatch noise. Trade-off accepted; we'll add the lint when the first miss happens.
- **Three of four new fields are not enforced.** That's by design (D4) but does mean adopters could silently misuse them (e.g., `lifecycle: 'disabled'` without a corresponding scope policy). Documentation + telemetry + control-plane tooling close that gap over time.

### Neutral

- ~70 LOC of net-new code (1 version constant, ~110 LOC semver-match.ts, 13 LOC version-check in `register()`, 4 type fields). Bundle impact: <0.5 KB of FESM.

---

## Alternatives considered

### A1 — Use the `semver` package

Pull `semver` as a runtime dep. ~50 KB minified, full range support.

**Rejected:** the bundle cost outweighs the benefit for the supported scope. The inline subset covers every realistic v1.x use case. We can adopt `semver` later if richer ranges become necessary; the swap is internal.

### A2 — `requiredHostVersion` throws on mismatch

Mismatched registration → `register()` throws.

**Rejected:** federated remotes loading into incompatible hosts would crash the host on capability registration, defeating the federation runtime's resilience. Silent skip + telemetry is the right behavior for the federation use case. Hosts that want strict behavior can wrap `register` in a custom registry subclass.

### A3 — Fold `requiredHostVersion` into `scopes`

Use the existing `scopes` array as the version constraint mechanism (e.g., `scopes: ['host>=1.2.0']`).

**Rejected:** `scopes` is for permission-style filtering (persona / role / environment); folding version constraints in muddles the abstraction. Separate fields, separate semantics.

### A4 — Add a `version` field on `RegistryEntry` (entry's own version)

Originally drafted; pulled before commit because `CapabilityManifest` (which `CapabilityDef` extends) already has a required `readonly version: string`, and TypeScript flags the optional-vs-required mismatch.

**Resolved:** dropped from this ADR. `CapabilityDef.version` covers the federation case via `CapabilityManifest`; other `RegistryEntry` subtypes can add their own version field if they need one (none currently do). If we revisit, the cleanest path is a separate field name (`entryVersion`) rather than `version`.

---

## Implementation

This ADR is implemented in the same PR. Files:

- `projects/agentic-ui/src/lib/version.ts` — new, 13 LOC, `LIB_VERSION` constant
- `projects/agentic-ui/src/lib/registries/semver-match.ts` — new, 110 LOC, `satisfies` + `isValidSemver`
- `projects/agentic-ui/src/lib/registries/semver-match.spec.ts` — new, ~70 LOC, table-driven tests across all supported + unsupported ranges
- `projects/agentic-ui/src/lib/types/registry-defs.ts` — extend `RegistryEntry` with 4 optional fields
- `projects/agentic-ui/src/lib/registries/registry-base.ts` — add the `requiredHostVersion` check at the top of `register()`
- `projects/agentic-ui/src/lib/registries/registry-base.spec.ts` — extend with governance-metadata block (3 cases)
- `projects/agentic-ui/src/lib/telemetry/telemetry-sink.ts` — add `agentic.registry.host_version_mismatch` event name
- [docs/architecture/platform-seams.md](../architecture/platform-seams.md) — update the entry-level metadata section

Out of scope for this PR (deferred):

- CI lint enforcing `LIB_VERSION` sync with `package.json`
- A scope-policy helper that filters out `lifecycle: 'deprecated'` entries by default
- Cookbook entry showing federation-version-pinning patterns

---

## References

- [ADR-002 — Layered registry system](./0002-layered-registry-system.md) — the `RegistryEntry` type extended here
- [ADR-010 — Platform principles, license, non-goals](./0010-platform-principles-and-license.md) — D3 (embedded-first) constrains the no-`semver`-dep choice; D4 (no breaking changes) constrains the additive-only design
- [ADR-011 — RegistryProviderHook](./0011-registry-provider-hook.md) — also extends `RegistryBase`; the two ADRs ship governance + multi-pod stories together
- [docs/plans/platform-evolution-plan.md](../plans/platform-evolution-plan.md) §4.1 R5 — the v3 plan entry that motivated this ADR
- [Semver 2.0 spec](https://semver.org/spec/v2.0.0.html) — the version-format reference
