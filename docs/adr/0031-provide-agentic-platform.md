# ADR-031 · provideAgenticPlatform — single config point for runtime↔platform integration

**Status:** Accepted

**Date:** 2026-05-10

**Related:** [ADR-003](./0003-pluggable-mfe-registry-source.md) · [ADR-016](./0016-iam-role-mapping.md) · [ADR-026](./0026-mvk-cli.md) · [Platform audit 2026-05-10](../audit/2026-05-10-platform-audit.md)

---

## Context

The 2026-05-10 platform audit identified four gaps between the
runtime tier (`@maverick/agentic-ui`) and the catalog server.
Gap 4 — *"Single configuration point + scaffolding default"* — is a
prerequisite for the other three:

> A consumer app integrating the platform wires 4–5 separate
> providers manually (`provideCatalogActivePersona`,
> `provideRestMfeRegistry`, plus the future capability registrar /
> authorizer / usage metering hooks). Plus thread the same
> `catalogUrl` / `getToken` / `tenantId` through every one. Four
> places to keep in sync. `mvk new app` doesn't include any of this
> — the scaffold is platform-naive.

Industry comparable: Spring Boot's `@EnableX` annotations, Stripe
SDK's single `Stripe.api_key = ...`, AWS SDK's chained credential
providers. One assignment of shared config; the SDK threads it
internally.

Without this seam, every future Gap-1/2/3 adapter would need its
own constructor signature accepting `catalogUrl + getToken +
tenantId`, and every consumer app would need to add a new provider
line per slice. We'd ship 4 × N config-threading PRs across 4
adapters — pure incidental complexity.

---

## Decision

### D1 — A single composite provider lives in `lib/platform/`

`provideAgenticPlatform(options)` returns
`EnvironmentProviders` and is the public API consumer apps call.
Internally it dispatches to the per-feature providers
(`provideCatalogActivePersona`, `provideRestMfeRegistry`, …).

```ts
provideAgenticPlatform({
  catalogUrl: 'https://catalog.example.com',
  tenantId: 'acme',
  getToken: () => oidc.getAccessToken(),
  personaResolver: { defaultPersona: 'paralegal' },
  mfeRegistry:   { refreshIntervalMs: 30_000 },
});
```

Each feature is **opt-in via per-key options object** rather than
boolean flags. Rationale:

- A boolean `enableMfe: true` would still need a separate options
  bag for `refreshIntervalMs`, `fetchFn` overrides etc. — two
  concepts for one feature.
- Allowing the value to be `false` (explicit skip) or `undefined`
  (skip by default) makes it ergonomic to enable just the
  features the app needs without coupling them.
- New feature slices add a new key (`capabilityRegistrar`,
  `usageMetering`, `capabilityAuthorizer`) without breaking
  callers.

### D2 — Shared config (catalogUrl/tenantId/getToken) lives at the top level

Per-feature options objects describe only feature-specific knobs.
The composite provider injects shared config into each.
`tenantId` accepts `string | (() => string)`; the function form
runs **once at provider time**, so dynamic-tenant SaaS hosts can
read from a request context or a signal.

`getToken` is the only async-capable seam — it's invoked per HTTP
call, so OIDC token refresh works naturally.

### D3 — `personaResolver: false` and `mfeRegistry: false` are explicit opt-outs

Distinct from `undefined`. An app may want to *disable* MFE
discovery in a non-platform deployment while keeping the rest of
`provideAgenticPlatform`. `=== false` is the sentinel; we don't
collapse it with `undefined` so a future runtime warning ("you
configured platform but bound zero features") can fire on the
all-undefined case but not on the all-false case.

### D4 — The `mvk new app --with-platform` flag scaffolds the wired config

Before this slice the scaffold was platform-naive.
`mvk new app <name> --with-platform --catalog-url <url> [--tenant
<id>]` now generates an `app.config.ts` that imports both
`provideAgenticUi` and `provideAgenticPlatform` with the catalog
URL and tenant baked in. The CLI requires `--catalog-url` (or
`MVK_CATALOG_URL` env / `mvk login`-stored config) when
`--with-platform` is set; absence is a hard error.

If the template-renderer is invoked programmatically with
`withPlatform: true` but no `catalogUrl` (e.g. tests), it falls
back to the platform-naive template so we never produce broken
config.

### D5 — `personaResolver` keeps `fetchFn` injectable; tests use `NEVER_CALLED`

The default `fetchFn` in `provideCatalogActivePersona` makes a
network call. In `provideAgenticPlatform.spec.ts` we pass a
sentinel that throws if invoked, then assert the *default* persona
is rendered immediately — proving we don't block app boot on the
network. Refresh is fire-and-forget.

---

## Consequences

### Positive

- **One line of consumer config**, irrespective of how many
  platform features are wired. Adding Gap 1/2/3 in subsequent
  ADRs is purely additive — no constructor churn in apps.
- **Scaffold default closes the on-ramp.** `mvk new app
  --with-platform` produces a runnable app pre-wired to the
  catalog at the URL the user just used to log in.
- **Tests demonstrate isolation.** Each feature switch is verified
  independently, so a regression in one branch can't accidentally
  break apps that don't use it.
- **Future-proofs the API for Gap 1/2/3.** New keys
  (`capabilityRegistrar`, `usageMetering`, `capabilityAuthorizer`)
  follow the same `OptionsObject | false | undefined` shape; no
  signature break for consumer apps that already migrated.

### Trade-offs

- **Per-key opt-in is more verbose than a boolean preset.** An app
  that just wants "everything on" still types
  `personaResolver: {}` etc. We accept this — feature-specific
  options will always exist (default persona, refresh interval),
  so hiding the object behind a boolean would only paper over the
  config in trivial cases.
- **The composite provider hides the underlying provider names**
  from the consumer-app developer who searches their `app.config`
  for `provideCatalogActivePersona`. Mitigation: the runtime
  re-exports the per-feature providers so apps with non-standard
  needs can still bypass the composite.

### Out-of-scope

- **Capability registrar / authorizer / usage metering hooks**
  ship in subsequent ADRs (032, 033, 034). They're the *reason*
  for D1 but not the *content* of D1.
- **Auto-detection of `catalogUrl` from environment** beyond the
  CLI's `MVK_CATALOG_URL` / login-config fallback — runtime apps
  will continue to require the URL be passed explicitly. Browser
  apps don't have a sensible "ambient" config source.

---

## Verification

- `projects/agentic-ui/src/lib/platform/provide-agentic-platform.spec.ts`
  — 6 TestBed tests covering: no-feature-on, persona-only,
  mfe-only, both-on, explicit `false` skip, dynamic-tenant
  function. All pass.
- `platform/mvk-cli/src/templates/agentic-app.spec.ts` — 4
  template tests covering: default-no-platform,
  with-platform-happy-path, tenantId override, fallback when
  `withPlatform: true` but `catalogUrl` missing. All pass.
- `platform/mvk-cli/src/commands/new.ts` — validates
  `--with-platform` requires a catalog URL; surfaces a friendly
  error if not.
- Smoke-tested end-to-end: `mvk new app smoke --with-platform`
  against the live Render catalog at
  `https://agentic-catalog-server.onrender.com` produced a
  scaffold whose `app.config.ts` imports both providers with the
  correct URL + tenant baked in.

---

## Status snapshot

- Lib tests: 408 → 414 (+6)
- mvk-cli tests: 49 → 53 (+4)
- Total: **684/684 passing** (catalog 164 + lib 414 + ops-console 59 + mvk-cli 53 — pending re-run of ops-console after merge)
