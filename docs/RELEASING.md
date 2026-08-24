# Versioning and release

Published packages follow [Semantic Versioning](https://semver.org/). Versions are tracked per package — see each package's `CHANGELOG.md` for its current version and release notes. (Packages historically tracked a unified version line; they may diverge as individual packages cut independent patch/minor releases.)

## Published packages

A GitHub Actions workflow at [`.github/workflows/publish.yml`](../.github/workflows/publish.yml) builds and publishes all **fifteen** packages to npm with [provenance attestations](https://docs.npmjs.com/generating-provenance-statements):

| Package | npm | Source dir | Purpose |
|---|---|---|---|
| [`@infra-tools/agentic-ui`](https://www.npmjs.com/package/@infra-tools/agentic-ui) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui) | [`projects/agentic-ui`](../projects/agentic-ui) | Angular runtime tier — chat shell, registries, F1–F6 capabilities, post-chat-surfaces (P0–P5). Ships the `ng-add`/`tool`/`widget`/`chat-shell`/`backend`/`agent-server`/`mfe-capability`/`connect-studio`/`action`/`intent`/`form`/`trigger`/`dashboard`/`playbook` schematics |
| [`@infra-tools/agentic-ui-server`](https://www.npmjs.com/package/@infra-tools/agentic-ui-server) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-server.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-server) | [`projects/agentic-ui-server`](../projects/agentic-ui-server) | Server-side helpers — generic Agent interface + AG-UI SSE route handler |
| [`@infra-tools/agentic-platform-schematics`](https://www.npmjs.com/package/@infra-tools/agentic-platform-schematics) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-platform-schematics.svg)](https://www.npmjs.com/package/@infra-tools/agentic-platform-schematics) | [`projects/agentic-platform-schematics`](../projects/agentic-platform-schematics) | Schematics that scaffold the entire platform monorepo (`projects/`, `platform/`, `examples/`) into a new workspace — security-sensitive scripts excluded |
| [`@infra-tools/agentic-catalog-server`](https://www.npmjs.com/package/@infra-tools/agentic-catalog-server) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-catalog-server.svg)](https://www.npmjs.com/package/@infra-tools/agentic-catalog-server) | [`platform/agentic-catalog-server`](../platform/agentic-catalog-server) | Capability catalog control-plane — Hono + Postgres (RLS) + JWT/JWKS, multi-tenant registry, audit trail ([ADR-015](./adr/0015-catalog-server-design.md)) |
| [`@infra-tools/agentic-ui-mcp`](https://www.npmjs.com/package/@infra-tools/agentic-ui-mcp) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-mcp.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-mcp) | [`projects/agentic-ui-mcp`](../projects/agentic-ui-mcp) | MCP server-side adapter — Claude Desktop / Cursor / Continue / Zed ([ADR-006](./adr/0006-mcp-server-side-adapter.md)) |
| [`@infra-tools/agentic-ui-opa-authorizer`](https://www.npmjs.com/package/@infra-tools/agentic-ui-opa-authorizer) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-opa-authorizer.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-opa-authorizer) | [`projects/agentic-ui-opa-authorizer`](../projects/agentic-ui-opa-authorizer) | OPA-backed `CapabilityAuthorizer` for fine-grained per-tool policy ([ADR-040](./adr/0040-opa-policy-integration.md)) |
| [`@infra-tools/aep-embed-sdk`](https://www.npmjs.com/package/@infra-tools/aep-embed-sdk) | [![npm](https://img.shields.io/npm/v/@infra-tools/aep-embed-sdk.svg)](https://www.npmjs.com/package/@infra-tools/aep-embed-sdk) | [`platform/aep-embed-sdk`](../platform/aep-embed-sdk) | Framework-agnostic SDK for consuming published experiences headlessly — fetch a render manifest with an embed key and drive it with your own components |
| [`@infra-tools/mvk`](https://www.npmjs.com/package/@infra-tools/mvk) | [![npm](https://img.shields.io/npm/v/@infra-tools/mvk.svg)](https://www.npmjs.com/package/@infra-tools/mvk) | [`platform/mvk-cli`](../platform/mvk-cli) | Command-line client — catalog ops, tenant lifecycle, audit verification, usage aggregates ([ADR-026](./adr/0026-mvk-cli.md)) |
| [`@infra-tools/agentic-ui-copilot-skill`](https://www.npmjs.com/package/@infra-tools/agentic-ui-copilot-skill) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-copilot-skill.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-copilot-skill) | [`projects/agentic-ui-copilot-skill`](../projects/agentic-ui-copilot-skill) | GitHub Copilot Extensions webhook adapter ([ADR-041](./adr/0041-teams-copilot-external-surfaces.md) / plan P2) |
| [`@infra-tools/agentic-ui-teams-bot`](https://www.npmjs.com/package/@infra-tools/agentic-ui-teams-bot) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-teams-bot.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-teams-bot) | [`projects/agentic-ui-teams-bot`](../projects/agentic-ui-teams-bot) | Microsoft Teams Bot Framework adapter — Adaptive Cards in Teams chat ([ADR-041](./adr/0041-teams-copilot-external-surfaces.md) / plan P1) |
| [`@infra-tools/agentic-ui-m365-agents`](https://www.npmjs.com/package/@infra-tools/agentic-ui-m365-agents) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-m365-agents.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-m365-agents) | [`projects/agentic-ui-m365-agents`](../projects/agentic-ui-m365-agents) | Microsoft 365 Agents SDK adapter — same Activity wire, broader channel set (Teams + M365 Copilot + Direct Line + sovereign clouds) |
| [`@infra-tools/agentic-ui-copilot-studio-connector`](https://www.npmjs.com/package/@infra-tools/agentic-ui-copilot-studio-connector) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-copilot-studio-connector.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-copilot-studio-connector) | [`projects/agentic-ui-copilot-studio-connector`](../projects/agentic-ui-copilot-studio-connector) | M365 Copilot Studio Connector — Power Platform actions invocable from M365 Copilot ([ADR-042](./adr/0042-copilot-studio-connector.md) / plan P3) |
| [`@infra-tools/agentic-ui-server-stores`](https://www.npmjs.com/package/@infra-tools/agentic-ui-server-stores) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-server-stores.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-server-stores) | [`projects/agentic-ui-server-stores`](../projects/agentic-ui-server-stores) | Redis + Postgres adapters for `ThreadStateStore` ([ADR-012](./adr/0012-thread-state-store-adapters.md)) |
| [`@infra-tools/agentic-ui-server-registrar`](https://www.npmjs.com/package/@infra-tools/agentic-ui-server-registrar) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-server-registrar.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-server-registrar) | [`projects/agentic-ui-server-registrar`](../projects/agentic-ui-server-registrar) | Server-side helper that auto-registers an agent server with the catalog ([ADR-039](./adr/0039-agent-auto-registration.md)) |
| [`@infra-tools/agentic-ui-webmcp`](https://www.npmjs.com/package/@infra-tools/agentic-ui-webmcp) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-webmcp.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-webmcp) | [`projects/agentic-ui-webmcp`](../projects/agentic-ui-webmcp) | WebMCP adapter — exposes the host's `ToolRegistry` to an in-browser agent via `navigator.modelContext`; scope- + approval-gated ([ADR-050](./adr/0050-webmcp-tool-exposure.md)) |

## How a publish works

The workflow is **version-driven, not tag-driven**. On each run it walks every package above and, for each, reads the version from that package's `package.json` and runs `npm view <pkg>@<version>`: if that exact version is already on npm the step is **skipped**, otherwise it publishes. So a run releases exactly the packages whose `package.json` version isn't on npm yet, and is always safe to re-run (already-published versions no-op).

The corollary: **to release a package, bump its `package.json` version** (and add a `CHANGELOG.md` entry). The `lib-version-guard` CI check ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) fails a PR that changes a publishable package's source without bumping its version, so releases never silently drift behind the repo.

## Triggering a publish

1. **Manual** (recommended): Actions tab → **publish** → **Run workflow** (on `main`). No inputs — it publishes whatever is unpublished.
2. **GitHub Release**: creating a Release fires the workflow on `release: published`. Tag names are informational only — the workflow does not parse them; what publishes is driven purely by the version-vs-npm check above.

## One-time setup — Trusted Publishing (OIDC)

Publishing uses **[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers)** (OIDC) — **no npm token**. The workflow has `id-token: write` and, with npm ≥ 11.5.1, exchanges a short-lived OIDC token at publish time (and attaches provenance).

**Configure a trusted publisher once per package** on npmjs.com — for *every* package in the table above:

> package page → **Settings → Trusted Publisher → GitHub Actions** → organization/repo `sahassakhare/agentic-ui`, workflow `publish.yml`, environment *(blank)*.

There is **no token fallback**: a package without a configured trusted publisher fails its publish step with an auth error (nothing half-publishes; re-run after configuring). The legacy `NPM_TOKEN`/bypass-2FA path has been removed.

## Versioning

Bump `package.json#version` on the commit that ships a package's change; annotated tags `<package>-v<MAJOR>.<MINOR>.<PATCH>` are a useful convention for humans but do not affect what publishes. Package-by-package independent versioning is supported.
