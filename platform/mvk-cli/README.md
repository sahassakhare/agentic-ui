# @maverick/mvk

**Command-line client for the Maverick agentic platform.** First slice
of M6 from the [platform-evolution plan](../../docs/plans/platform-evolution-plan.md).
Apache 2.0.

Operators use `mvk` for catalog ops the ops console can't easily do:
bulk capability registration, scripting, CI workflows, audit-chain
verification in pipelines. Pairs with the
[ops console](../agentic-ops-console/) (interactive UI) and the
[catalog server](../agentic-catalog-server/) (API).

---

## Install

Once published to npm:

```bash
npm install -g @maverick/mvk
mvk --version
# → 0.1.0
```

For local dev from this monorepo:

```bash
cd platform/mvk-cli
npm install
npm run build
node bin/mvk.js help
```

---

## Quick start

### 1. Point the CLI at your catalog

```bash
mvk login \
  --catalog-url https://catalog.example.com \
  --token eyJhbGciOiJSUzI1NiIs...
```

Saves `~/.mvk/config.json` (chmod 600). Re-run with new flags to
overwrite. For trusted-network deployments where the catalog runs
[`AUTH_MODE=disabled`](../../docs/adr/0022-auth-disabled-mode.md):

```bash
mvk login \
  --catalog-url https://catalog.your-org.com \
  --auth-mode disabled \
  --tenant-id demo
```

Verify:

```bash
mvk whoami
# catalogUrl: https://catalog.your-org.com
# authMode:   disabled
# token:      null
# defaultTenantId: demo

mvk health
# {"status":"ok","authMode":"disabled"}
```

### 2. Tenant ops (platform-admin)

```bash
mvk tenant list
mvk tenant create --id acme --display-name "Acme Corp" \
  --quotas-json '{"monthlyTokens":1000000}'
mvk tenant suspend acme --reason "trial expired"
mvk tenant activate acme
mvk tenant delete acme --force
```

### 3. Capabilities

```bash
# Single registration
mvk capability register \
  --tenant acme \
  --kind tool \
  --name bookFlight \
  --body-json '{"description":"Books a flight"}' \
  --tag travel,booking \
  --owner my-team

# Lifecycle change
mvk capability patch <id> --tenant acme --lifecycle deprecated

# Bulk from JSONL (one capability per line)
cat caps.jsonl | mvk capability register --tenant acme --bulk

mvk capability list --tenant acme --kind tool
```

### 4. Audit + usage

```bash
mvk audit verify --tenant acme
# ✓ chain valid — 54 rows verified (head @ 54 = bd2cd9b3…)

mvk audit export --tenant acme --out audit.jsonl

mvk usage --tenant acme
# tenant: acme
# total: 31 events, 41,090 units
#
# KIND               QUANTITY  %
# ─────────────────  ────────  ─────
# llm.tokens.input   32,600    79.3%
# llm.tokens.output  8,400     20.4%
# tool.invoke        47        0.1%
# mfe.fetch          43        0.1%
```

---

## Configuration precedence

```
command-line flag > env var > ~/.mvk/config.json > defaults
```

Env vars: `MVK_CATALOG_URL`, `MVK_TOKEN`, `MVK_AUTH_MODE`, `MVK_TENANT_ID`.

CI workflows typically skip the config file entirely:

```bash
MVK_CATALOG_URL=https://catalog.your-org.com \
MVK_TOKEN=$CATALOG_DEPLOY_TOKEN \
mvk audit verify --tenant production
# exit 0 = chain valid
# exit 2 = chain BROKEN; alert + investigate
```

---

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Bad usage / missing required flag / unknown command |
| 2 | Catalog returned a 4xx (validation, auth, scope), or `audit verify` reports the chain is broken |
| 5 | Catalog returned a 5xx |

Pipe-friendly: every command supports `--json` for machine-readable
output. `--quiet` suppresses non-error stdout (useful in scripts that
only care about the exit code).

---

## Commands

```
mvk login              save catalog URL + token
mvk whoami             show config (token redacted)
mvk health             /healthz
mvk ready              /readyz (DB connectivity)

mvk tenant list        list all tenants
mvk tenant get <id>    get one tenant
mvk tenant create      onboard a tenant
mvk tenant suspend     suspend with reason
mvk tenant activate    resume suspended tenant
mvk tenant delete      soft-delete

mvk capability list    list capabilities
mvk capability register   register a capability (or bulk from stdin)
mvk capability patch <id> patch lifecycle / owner
mvk capability delete <id> soft-delete

mvk audit verify       re-walk chain server-side
mvk audit export       JSONL stream

mvk usage              aggregate by kind
mvk usage recent       most recent events
```

`mvk help` for the full list with descriptions, `--help` after any
subcommand for usage.

---

## License

Apache 2.0 — see [LICENSE](../../LICENSE). Same as the rest of the
platform.
