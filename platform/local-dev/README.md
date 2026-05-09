# Local-dev fixtures

These files are **only** for `docker compose -f platform/docker-compose.yml up`
local development. They do not ship in production deployments.

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
