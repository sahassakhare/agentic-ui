# ADR-026 · `mvk` CLI v1 — first slice of M6

**Status:** Accepted

**Date:** 2026-05-09

**Related:** [ADR-015](./0015-catalog-server-design.md) · [ADR-019](./0019-ops-console-design.md) · [ADR-021](./0021-self-managed-packaging.md) · [ADR-022](./0022-auth-disabled-mode.md)

---

## Context

The platform now has the catalog server (T2), the ops console
(read + edit UI), and a Render demo. Three distinct gaps:

1. **Bulk operations.** Onboarding 100 capabilities by clicking
   modals is friction; the ops console doesn't have a bulk-import
   path (per [ADR-023](./0023-ops-console-editor-surfaces.md) §Out
   of scope).
2. **CI workflows.** Pipelines need a non-interactive way to verify
   the audit chain on every deploy, register capabilities from a
   manifest file, etc. `curl` works but is verbose + hand-rolls the
   error handling.
3. **Adopters without an ops console.** Self-hosters who run the
   catalog headless (no UI) need a way to administer it.

Plan v3 §7.1 names this work as M6 — "Multi-framework SDKs +
CLI v1." This ADR codifies the CLI half. The SDK half (WC core +
React + Vue) is a separate, larger slice; the CLI is the
self-contained piece operators get value from immediately.

---

## Decision

### D1 — Hand-rolled argv parser; only `zod` as runtime dep

The CLI ships with `zod` as the sole runtime dependency. Argument
parsing, dispatch, output formatting are all hand-written
(~300 LOC). Reasons:

- **Install footprint matters for a CLI.** `npm install -g
  @maverick/mvk` should pull < 200 KB. Commander/yargs are 1+ MB
  with their dep trees.
- **Behaviour is small enough.** Five resource families, ~20
  subcommands, no plugin system. A 100-line parser covers it.
- **Stable.** A pinned hand-rolled parser doesn't break on
  yargs/commander upgrades.

Future growth (interactive prompts, shell completions) would
justify pulling in commander/inquirer. v1 doesn't need them.

### D2 — Tree-of-commands dispatch with `_default` fallback

Commands are organised as a nested object:

```ts
const ROOT = {
  tenant: {
    list: tenantList,
    create: tenantCreate,
    suspend: tenantSuspend,
    ...
  },
  usage: {
    _default: usageAggregate,    // bare `mvk usage` runs this
    recent: usageRecent,
  },
  health: healthCommand,
};
```

The dispatcher walks the user's positional args against the tree.
If the path lands at a Command, it runs. If it lands at a
CommandTree with a `_default` Command, that runs (so `mvk usage`
defaults to aggregate; `mvk usage recent` is the explicit form).

This shape scales: M7 community-catalog work could add `mvk
catalog publish`, `mvk catalog scan`; M8 attestation work could
add `mvk attest sign`, `mvk attest verify`. New subtrees plug in
without touching the dispatcher.

### D3 — Config in `~/.mvk/config.json` (chmod 600); env vars + flags override

Three layers, highest precedence first:

1. CLI flags: `--catalog-url`, `--token`, `--auth-mode`, `--tenant`
2. Env vars: `MVK_CATALOG_URL`, `MVK_TOKEN`, `MVK_AUTH_MODE`, `MVK_TENANT_ID`
3. File: `~/.mvk/config.json`

The file holds a token in plain text. We rely on filesystem
permissions (chmod 600) for confidentiality, the same model as
`~/.aws/credentials`, `~/.kube/config`, `~/.netrc`. Operators
who want OS keychain integration can run with env vars instead
and source the token from `keychain` / `pass` / `op cli`.

The file is opt-out for CI: setting any of the env vars without
running `mvk login` first means the file is never created.

### D4 — Resource-oriented commands, NOT verb-first

`mvk tenant list`, `mvk capability register`, `mvk audit verify` —
not `mvk list tenants`, `mvk register capability`. Reasons:

- **Tab completion.** Resource-first lets shells offer `tenant`,
  `capability`, `audit` as the first completion stage; verb is
  scoped to that resource. Easier discovery for new users.
- **Matches the catalog REST API.** `/v1/tenants/<id>/suspend`
  → `mvk tenant suspend <id>`. The mapping is mechanical, which
  makes the CLI predictable.
- **Common pattern.** kubectl, gh, doctl, fly all do
  resource-first.

### D5 — Bulk register via stdin JSONL

`mvk capability register --bulk` reads JSONL from stdin (one JSON
object per line, each a `CapabilityCreate` payload). For each
line, POSTs to `/v1/catalogs/{tenant}/capabilities`; on
unique-violation reports + continues. Exit 0 if every line
succeeded, 1 otherwise.

Why JSONL not YAML / JSON-array:

- **Stream-able.** A 10 000-row import doesn't load into memory.
- **Tool-friendly.** `jq -c` emits JSONL natively; pipelines that
  generate from spreadsheets / DBs trivially produce it.
- **Failure-safe.** A single bad line skips that line; doesn't
  abort the whole batch.

### D6 — Exit codes carry semantic information

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Bad usage / missing required flag / unknown command |
| 2 | Catalog 4xx, OR `audit verify` reports a broken chain |
| 5 | Catalog 5xx |

Audit-chain verify returning **2** on broken chain (not 0) lets
CI pipelines `mvk audit verify || page-oncall` without parsing
output. This is the SOC 2-grade integrity check for self-hosters.

### D7 — `--json` everywhere; tables for humans

Every command supports `--json` for machine-readable output.
Default is human-readable: tables for lists, pretty JSON for
single-resource gets, plain text for status checks.

We hand-roll the table renderer (no `cli-table3` etc.) — it's
~40 lines, honours the `--quiet` flag, and avoids ANSI dependencies
that bloat the install.

### D8 — Catalog interaction goes through one tiny client

`src/catalog-client.ts` is a ~50-line wrapper around `fetch`. It
adds the bearer token (or skips it in disabled mode), surfaces
RFC 7807 problem+json `detail` strings as error messages, and
throws `CatalogError` with the HTTP status preserved. Every
command goes through it; the dispatcher converts thrown
`CatalogError` to the right exit code.

We deliberately don't auto-generate from OpenAPI. The catalog's
OpenAPI is stable and small; a code-gen step would add
maintenance burden without payoff.

---

## Consequences

### Positive

- **Bulk + scripting unlocked.** Operators do `cat
  capabilities.jsonl | mvk capability register --bulk` to onboard
  a fleet's worth of capabilities.
- **CI integration straightforward.** `mvk audit verify` returns
  exit 2 on a broken chain; pipelines page oncall without parsing
  text.
- **Tiny install.** ~200 KB unpacked. Pairs with the existing
  Render demo: paste the URL into `--catalog-url` and you're
  done.
- **22 unit tests** covering argv parsing, catalog client (auth,
  error mapping, query strings), and CLI dispatch (help, version,
  unknown commands, exit codes for chain verify + 4xx).

### Negative / risks

- **No interactive prompts.** `mvk login` is non-interactive
  (operator pastes token via flag or env). Adopters used to
  `gh auth login` browser flow may want this; defer to v0.2.
- **Hand-rolled parser may grow brittle.** If we add complex
  features (subcommand-specific help layouts, completion shell
  scripts) we may need to switch to commander. v1 is well within
  what hand-roll handles.
- **Token lives plain on disk.** ADR notes this matches AWS / kube
  conventions; operators who need keychain integration use env
  vars instead.

### Out of scope (deferred)

- **Interactive `mvk login` (browser-flow OIDC).** Useful for
  adopters with real IdPs; defer to v0.2 alongside the OIDC
  redirect-flow ops-console work (C6.4 in
  [ADR-019](./0019-ops-console-design.md)).
- **Shell completions** (`bash` / `zsh` / `fish`). Generate from
  the command tree; defer until adopter feedback shows demand.
- **`mvk new <project>` scaffolding.** Generate a new agentic-ui
  app + register it against the catalog. Substantial — touches
  the runtime tier's schematics package and the catalog seed
  story. Useful but out of CLI v1 scope.
- **Plugin system.** `mvk plugin install <name>`. Maybe at M7
  when the community catalog lands.
- **Output formatters beyond JSON / tables.** YAML, CSV, etc.
  Trivial to add when needed.

---

## Implementation summary

Package `platform/mvk-cli/` (`@maverick/mvk@0.1.0`):

- `bin/mvk.js` — Node shebang entrypoint that imports `dist/cli.js`
  and calls `run(process.argv.slice(2))`.
- `src/cli.ts` — argv parse → command lookup → dispatch with
  global flag handling (`--json`, `--catalog-url`, etc.) and
  RFC 7807 error mapping to exit codes.
- `src/argv.ts` — flag/positional separator. Subcommand resolution
  is the dispatcher's job (walks the tree against positionals).
- `src/config.ts` — three-layer precedence + Zod validation.
- `src/catalog-client.ts` — typed `fetch` wrapper.
- `src/output.ts` — JSON / table emit + error formatting.
- `src/commands/` — one file per resource (login, tenant,
  capability, audit, usage, health).

Tests (22):

- `src/argv.spec.ts` — 7 parser tests
- `src/catalog-client.spec.ts` — 6 HTTP client tests (auth modes,
  query string, error surfacing)
- `src/cli.spec.ts` — 9 dispatch tests with stubbed `fetch`

End-to-end smoke against the deployed Render catalog confirms
every command path works against the live system.
