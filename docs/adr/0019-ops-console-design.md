# ADR-019 · Ops Console — read-only viewer over the catalog (M2 C6 v0)

**Status:** Accepted

**Date:** 2026-05-09

**Related:** [ADR-010](./0010-platform-principles-and-license.md) · [ADR-015](./0015-catalog-server-design.md) · [ADR-016](./0016-iam-role-mapping.md) · [ADR-017](./0017-audit-chain.md) · [ADR-018](./0018-usage-meter.md)

---

## Context

The M2 catalog server now exposes capabilities, MFE remotes, IAM
role mappings, an audit chain, and a usage meter. Operators
running the catalog need a way to **see** this data without
hand-rolling REST clients or living in `psql`.

Plan v3 §7.1 places "Ops Console v0 (catalog viewer only)" inside
M2. The qualification "catalog viewer only" is load-bearing — it
keeps the v0 surface narrow enough to ship inside the M2 timebox
without introducing the design surface of admin-style mutation
flows.

This ADR captures what we built and why.

---

## Decision

### D1 — Separate package, separate Angular app

`platform/agentic-ops-console/` is its own Angular 21 standalone
application — not a feature of the runtime tier and not embedded
into the catalog server. Reasons:

- **Boundary clarity.** The runtime tier (T1) ships into adopter
  applications and stays embedded-first. Operator UI is a different
  concern (T2, sometimes hosted next to the catalog server, sometimes
  isolated as an independent deployment).
- **Independent build cadence.** The operator surface evolves at
  a different rate than the runtime library. Coupling them would
  force runtime adopters to pull operator-tooling weight.
- **Reusable as a starting point.** Self-hosters who want a custom
  ops UI fork this package and replace pages as needed; the
  catalog REST API is the seam, not the console codebase.

The package will move to the `agentic-platform-control-plane`
repo when M2 GAs (per ADR-010 D6).

### D2 — Read-only in v0; editing in C6.1

Every page renders. None of them mutate. Operators perform
mutations today via:

1. The catalog REST API directly (`curl` / `httpie`).
2. `psql` for emergency interventions (`platform-admin` role with
   `BYPASSRLS`).

Why not edit in v0:

- **Form design surface.** "Create capability" alone has 5+ kinds
  with kind-specific bodies; we don't yet have a clear UX target
  for a generic editor. Shipping a mediocre editor would calcify
  the wrong shape.
- **Audit weight.** Every mutation appends to the chained audit
  log. Bad-UX edits become bad audit history. Better to validate
  the read-side surfaces against real operator workflows first
  (does the console show the right shape of data? are filters
  useful? is the audit verify status the right primary signal?)
  and then layer mutation on top of validated reads.
- **Time to ship.** Read-only fits inside M2; full editor would
  push C6 into M3 territory.

C6.1 will add per-resource editor modals once we have signal from
real adopters about which mutations they actually want in the UI
vs. via API.

### D3 — JWT paste-in for v0; full OIDC flow in C6.1

The login screen accepts a pasted JWT. The console parses tenant
+ roles from the token's claims; the catalog server validates the
signature and enforces tenant scope.

Why not in-browser PKCE today: the UX target depends on the
adopter's IdP topology (Auth0 SPA SDK, msal-js, oidc-client-ts,
home-grown server-mediated flow). Picking one for v0 risks locking
out adopters whose IdP integration looks different. Paste-in is
deliberately lowest-common-denominator; we'll add proper OIDC
flows in C6.1 once we know which IdP integrations matter.

Self-hosters who want a tighter login UX can replace
`LoginComponent` and `AuthService` without touching the rest of
the console — the auth boundary is a single token-string in/out.

### D4 — Signals everywhere; no global state container

Each page uses Angular signals to hold its loaded state. There's
no NgRx, no Redux, no service-level store. Reasons:

- **Each page is a list view.** State is "the items I loaded."
  No cross-page reads, no derived selectors, no complex update
  graphs. A signal per page is exactly the right unit.
- **Zoneless change detection.** The app is configured zoneless
  (`provideZonelessChangeDetection`). Signal updates re-render
  exactly the touched bindings.
- **Less to learn.** Operators forking this package don't need
  an extra state-management mental model.

### D5 — Lazy-loaded routes

Every page is lazy-loaded. The initial bundle stays small (1.4 MB
raw at v0; ~400 KB initial chunk after route splitting). Adopters
who only ever view the audit page don't pay for the usage page's
date-pipe footprint.

### D6 — In-app JSONL download via Blob URL

The audit export endpoint returns `Content-Disposition:
attachment` so a direct browser navigation works as a download.
But operators are inside the console UI; we want the download to
feel native to the page, not bounce through the URL bar.

The console fetches the JSONL through the authenticated HTTP
client (so the Bearer token rides along automatically), wraps it
in a Blob URL, and triggers a programmatic `<a download>` click.
Tested in Chromium / Firefox / Safari.

For very large exports (>100k rows) this approach buffers in
memory; the catalog server caps at 100 000 rows per request which
is enough for most ops workflows. Streaming SSE export is
deferred (same as ADR-015).

### D7 — Monochrome / ops-tool aesthetic

The console looks like an ops tool: dark theme, sans-serif body,
monospace data. Deliberately not a customer-facing product UI.
Reasons:

- **Audience.** Operators (SREs, platform engineers) prefer
  density to whitespace.
- **No design system.** Adding one would commit us to maintaining
  it; not adding one keeps the surface easy to fork.

---

## Consequences

### Positive

- **Operators get a working visibility tool now.** They were
  previously living in `psql`.
- **Read-side validation surface.** Adopters who try the console
  give us signal on what's missing before we lock in mutation
  flows.
- **Forkable.** Self-hosters who need a different ops UI replace
  pages without touching the seams.
- **Aligns with the v3 plan.** §7.1 said "v0 = catalog viewer
  only." That's what this is.

### Negative / risks

- **No mutations.** Operators who want UI-driven create / edit
  must wait for C6.1 or use `curl`. Documented; the catalog
  README links to the API docs.
- **No SSO.** The paste-in login is intentionally Spartan. Adopters
  who insist on SSO from day one fork this package. Documented.
- **In-memory JSONL download.** Big tenants (>100k audit rows)
  need to use the API directly until streaming export ships.

### Out of scope (deferred)

- **C6.1: editor surfaces.** Create capability / edit role mapping /
  health-record refresh / suspend tenant. Modal-based, with
  optimistic UI + rollback on server error.
- **C6.2: live updates.** SSE-driven incremental rendering when
  the catalog gains an event channel (catalog-side SSE deferred
  in ADR-015).
- **C6.3: dashboards.** Time-series charts on the usage page once
  we know which time ranges operators actually want.
- **C6.4: full OIDC.** PKCE in-browser or server-mediated, picked
  based on adopter IdP-integration surveys.

---

## Implementation summary

- New package: `platform/agentic-ops-console/` — Angular 21 standalone
  app with `@angular/build:application` builder.
- Routes: `/login`, `/capabilities`, `/mfes`, `/role-mappings`,
  `/audit`, `/usage`. All authenticated routes guarded by
  `authGuard`.
- Services:
  - `AuthService` (`providedIn: 'root'`) — holds JWT in localStorage,
    parses principal as a signal.
  - `CatalogClientService` — typed REST wrappers for every catalog
    surface (capabilities, mfes, role-mappings, audit, usage).
- Tests: 19 unit tests (auth service, catalog client, login component).
- Build: `npx ng build agentic-ops-console` produces a 1.4 MB raw
  bundle (~400 KB initial chunk).
- `angular.json` wired with `serve` (port 4500 — the 4300–4304 band
  is reserved for the eDiscovery demo shell + remotes) and `test`
  (`@angular/build:unit-test`) targets.
