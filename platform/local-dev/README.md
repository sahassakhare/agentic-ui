# Local-dev fixtures

These files are **only** for local development. They do not ship in production
deployments.

## One-command stack: `dev-up.sh` / `dev-down.sh`

Bring the whole platform up natively (no Docker needed) — the six services the
Studio + Hub need, in dependency order, each **idempotent** (a port already
listening is left alone) and behind a **health gate**. The catalog runs on the
embedded H2 `local` profile, so there's no external database to start.

```bash
./platform/local-dev/dev-up.sh          # start everything
./platform/local-dev/dev-up.sh studio   # start only named service(s)
./platform/local-dev/dev-down.sh        # stop everything
```

| Service | Port | Notes |
|---|---|---|
| catalog (Java + H2) | 8081 | needs JDK 21 (`mvn spring-boot:run`, `local` profile) |
| ingest | 4320 | seeded with the `matter-management` remote so the Hub's matter widgets resolve |
| matter-management MFE | 4301 | Native-Federation remote the Hub loads |
| agent (demo-server) | 4111 | needs `examples/demo-server/.env` (Gemini key) or the copilot is echo-only |
| Studio | 4600 | authoring |
| Hub | 4700 | runtime |

Logs stream to `platform/local-dev/.logs/<svc>.log` (gitignored). First run of
the Angular dev servers (Studio/Hub/MFE) compiles for ~1–2 min — the health gate
waits. Prereqs: `npm ci` at the repo root, JDK 21, and the demo-server `.env`.
Studio `environment.ts` `authMode` is intentionally kept local — the launcher
does not touch it.

## `dev-jwks/`

A static directory served by an nginx container at `http://dev-jwks/`. The
catalog server is configured against `OIDC_ISSUER=http://dev-jwks/` so it
treats this nginx as a real IdP and pulls `/.well-known/jwks.json` to
validate JWT signatures.

Out of the box, [`jwks.json`](./dev-jwks/.well-known/jwks.json) is a
**placeholder with an empty `keys` array**. The catalog will reject every
request until you replace it with a real JWKS document. To generate one
once and reuse:

```bash
node platform/local-dev/mint-dev-key.mjs
```

That script writes:
- `platform/local-dev/dev-jwks/.well-known/jwks.json` — public JWK
- `platform/local-dev/dev-private.pem` — the matching RSA private key
  (gitignored — paste it into your IdP-mock OR use the bundled
  `mint-token.mjs` to mint a token for the ops console paste-in flow)

## `mint-token.mjs`

Mints a JWT signed with `dev-private.pem`. Pipe it into your clipboard
and paste into the ops console's login page:

```bash
node platform/local-dev/mint-token.mjs --tenant test-tenant --roles platform-admin | pbcopy
```

Default claims (override with flags):

| Flag | Default | Notes |
|---|---|---|
| `--sub` | `u-001` | JWT subject |
| `--tenant` | `test-tenant` | `tenant_id` claim |
| `--roles` | `member` | Comma-separated role list |
| `--name` | `Local Dev` | Display name |
| `--audience` | `agentic-catalog` | `aud` claim |
| `--expires-in` | `8h` | jose-style duration |

## Why all this?

The catalog server enforces full OIDC validation (issuer + audience +
JWKS signature + clock skew). Local dev needs a working OIDC pair without
standing up Keycloak. This three-file fixture (jwks.json + private key +
mint script) is the smallest thing that satisfies the catalog without
weakening its checks.
