# Versioning and release

Published packages follow [Semantic Versioning](https://semver.org/). Versions are tracked per package — see each package's `CHANGELOG.md` for its current version and release notes. (Packages historically tracked a unified version line; they may diverge as individual packages cut independent patch/minor releases.)

## Published packages

A GitHub Actions workflow at [`.github/workflows/publish.yml`](../.github/workflows/publish.yml) builds and publishes all **eleven** packages to npm with [provenance attestations](https://docs.npmjs.com/generating-provenance-statements):

| Package | npm | Source dir | Purpose |
|---|---|---|---|
| [`@infra-tools/agentic-ui`](https://www.npmjs.com/package/@infra-tools/agentic-ui) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui) | [`projects/agentic-ui`](../projects/agentic-ui) | Angular runtime tier — chat shell, 18 registries, F1–F6 capabilities, post-chat-surfaces (P0–P5) |
| [`@infra-tools/agentic-ui-server`](https://www.npmjs.com/package/@infra-tools/agentic-ui-server) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-server.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-server) | [`projects/agentic-ui-server`](../projects/agentic-ui-server) | Server-side helpers — generic Agent interface + AG-UI SSE route handler |
| [`@infra-tools/agentic-ui-mcp`](https://www.npmjs.com/package/@infra-tools/agentic-ui-mcp) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-mcp.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-mcp) | [`projects/agentic-ui-mcp`](../projects/agentic-ui-mcp) | MCP server-side adapter — Claude Desktop / Cursor / Continue / Zed ([ADR-006](./adr/0006-mcp-server-side-adapter.md)) |
| [`@infra-tools/agentic-ui-copilot-skill`](https://www.npmjs.com/package/@infra-tools/agentic-ui-copilot-skill) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-copilot-skill.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-copilot-skill) | [`projects/agentic-ui-copilot-skill`](../projects/agentic-ui-copilot-skill) | GitHub Copilot Extensions webhook adapter ([ADR-041](./adr/0041-teams-copilot-external-surfaces.md) / plan P2) |
| [`@infra-tools/agentic-ui-teams-bot`](https://www.npmjs.com/package/@infra-tools/agentic-ui-teams-bot) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-teams-bot.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-teams-bot) | [`projects/agentic-ui-teams-bot`](../projects/agentic-ui-teams-bot) | Microsoft Teams Bot Framework adapter — Adaptive Cards in Teams chat ([ADR-041](./adr/0041-teams-copilot-external-surfaces.md) / plan P1) |
| [`@infra-tools/agentic-ui-m365-agents`](https://www.npmjs.com/package/@infra-tools/agentic-ui-m365-agents) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-m365-agents.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-m365-agents) | [`projects/agentic-ui-m365-agents`](../projects/agentic-ui-m365-agents) | Microsoft 365 Agents SDK adapter — successor to the Bot Framework adapter; same Activity wire, broader channel set (Teams + M365 Copilot + Direct Line + sovereign clouds) |
| [`@infra-tools/agentic-ui-copilot-studio-connector`](https://www.npmjs.com/package/@infra-tools/agentic-ui-copilot-studio-connector) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-copilot-studio-connector.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-copilot-studio-connector) | [`projects/agentic-ui-copilot-studio-connector`](../projects/agentic-ui-copilot-studio-connector) | M365 Copilot Studio Connector — Power Platform actions invocable from M365 Copilot ([ADR-042](./adr/0042-copilot-studio-connector.md) / plan P3) |
| [`@infra-tools/agentic-ui-server-stores`](https://www.npmjs.com/package/@infra-tools/agentic-ui-server-stores) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-server-stores.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-server-stores) | [`projects/agentic-ui-server-stores`](../projects/agentic-ui-server-stores) | Redis + Postgres adapters for `ThreadStateStore` ([ADR-012](./adr/0012-thread-state-store-adapters.md)) |
| [`@infra-tools/agentic-ui-server-registrar`](https://www.npmjs.com/package/@infra-tools/agentic-ui-server-registrar) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-server-registrar.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-server-registrar) | [`projects/agentic-ui-server-registrar`](../projects/agentic-ui-server-registrar) | Server-side helper that auto-registers an agent server with the catalog ([ADR-039](./adr/0039-agent-auto-registration.md)) |
| [`@infra-tools/agentic-ui-opa-authorizer`](https://www.npmjs.com/package/@infra-tools/agentic-ui-opa-authorizer) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-opa-authorizer.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-opa-authorizer) | [`projects/agentic-ui-opa-authorizer`](../projects/agentic-ui-opa-authorizer) | OPA-backed `CapabilityAuthorizer` for fine-grained per-tool policy ([ADR-040](./adr/0040-opa-policy-integration.md)) |
| [`@infra-tools/agentic-ui-webmcp`](https://www.npmjs.com/package/@infra-tools/agentic-ui-webmcp) | [![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-webmcp.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-webmcp) | [`projects/agentic-ui-webmcp`](../projects/agentic-ui-webmcp) | WebMCP adapter — exposes the host's `ToolRegistry` to an in-browser agent via `navigator.modelContext`; scope- + approval-gated ([ADR-050](./adr/0050-webmcp-tool-exposure.md)) |

## Triggering a publish

Two ways to trigger a publish:

1. **GitHub Release** (recommended). Tag the commit with one of the recognised prefixes:
   - `agentic-ui-v<X.Y.Z>` → `@infra-tools/agentic-ui`
   - `agentic-ui-server-v<X.Y.Z>` → `@infra-tools/agentic-ui-server`
   - `agentic-ui-mcp-v<X.Y.Z>` → `@infra-tools/agentic-ui-mcp`
   - `agentic-ui-copilot-skill-v<X.Y.Z>` → `@infra-tools/agentic-ui-copilot-skill`
   - `agentic-ui-teams-bot-v<X.Y.Z>` → `@infra-tools/agentic-ui-teams-bot`
   - `agentic-ui-m365-agents-v<X.Y.Z>` → `@infra-tools/agentic-ui-m365-agents`
   - `agentic-ui-copilot-studio-connector-v<X.Y.Z>` → `@infra-tools/agentic-ui-copilot-studio-connector`
   - `agentic-ui-server-stores-v<X.Y.Z>` → `@infra-tools/agentic-ui-server-stores`
   - `agentic-ui-server-registrar-v<X.Y.Z>` → `@infra-tools/agentic-ui-server-registrar`
   - `agentic-ui-opa-authorizer-v<X.Y.Z>` → `@infra-tools/agentic-ui-opa-authorizer`
   - `agentic-ui-webmcp-v<X.Y.Z>` → `@infra-tools/agentic-ui-webmcp`
   - `v<X.Y.Z>` (legacy) → primary `@infra-tools/agentic-ui`

   Then create the GitHub Release for that tag — the workflow fires automatically on `release: published`.

2. **Manual trigger** (Actions tab → `publish` → **Run workflow**). Pick a package or `all`, optionally tick `dry_run` to test the workflow without pushing to npm. Already-published versions are skipped — safe to re-run.

## One-time setup

Generate an npm **Granular Access Token** (npmjs.com → Access Tokens → Generate New Token → Granular Access Token) with **Read and write** on the `@infra-tools` scope and **"Allow this token to bypass 2FA"** enabled (required for non-interactive CI publishes when your account has 2FA-on-publish on). Add to GitHub: **Settings → Secrets and variables → Actions → New repository secret → name `NPM_TOKEN`**.

Once the first publish succeeds, switching to [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers) is recommended — the workflow already requests an OIDC token, so the secret can then be removed.

## Tagging convention

Annotated tags `<package>-v<MAJOR>.<MINOR>.<PATCH>` against the commit that bumps that package's `package.json#version`. Package-by-package independent versioning is supported by the workflow.
