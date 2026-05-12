# @infra-tools/agentic-ui-opa-authorizer

[![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui-opa-authorizer.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui-opa-authorizer)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

Optional runtime plugin for [`@infra-tools/agentic-ui`](https://www.npmjs.com/package/@infra-tools/agentic-ui) that gates `ToolRegistry` and `ComponentRegistry` reads through **Open Policy Agent (OPA)** decisions. Lets you express per-tool / per-widget authorization in Rego instead of TypeScript predicates.

Slice OPA-B / [ADR-040](https://github.com/sahassakhare/agentic-ui/blob/main/docs/adr/0040-opa-policy-integration.md). Lives outside the core lib per [ADR-010 D4](https://github.com/sahassakhare/agentic-ui/blob/main/docs/adr/0010-platform-principles-and-license.md) — adopters who don't want OPA pay nothing.

> Need simpler authorization? `provideCatalogCapabilityAuthorizer` ([ADR-033](https://github.com/sahassakhare/agentic-ui/blob/main/docs/adr/0033-catalog-capability-authorizer.md)) in the core lib already handles lifecycle-flag-based deny-lists from the catalog. This package is for richer, policy-expression-based decisions.

## Install

```bash
npm install @infra-tools/agentic-ui-opa-authorizer
```

Peer: [`@infra-tools/agentic-ui`](https://www.npmjs.com/package/@infra-tools/agentic-ui) `>=1.2.0` — the plugin composes onto its `RegistryBase.setScopePolicy()` seam.

## Wire it up

```ts
import { provideAgenticUi, provideAgenticPlatform } from '@infra-tools/agentic-ui';
import { provideOpaAuthorizer } from '@infra-tools/agentic-ui-opa-authorizer';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAgenticUi({ tools: [...], widgets: [...] }),
    provideAgenticPlatform({
      catalogUrl: 'https://catalog.example.com',
      tenantId: 'acme',
      getToken: () => oidc.getAccessToken(),
      capabilityAuthorizer: false,   // disable lifecycle-flag deny-list authorizer
    }),
    provideOpaAuthorizer({
      catalogUrl: 'https://catalog.example.com',
      tenantId: 'acme',
      getToken: () => oidc.getAccessToken(),
      subject: () => ({ persona: persona.active(), tenant: tenantId }),
      cacheTtlMs: 5_000,
      onMiss: 'allow',
    }),
  ],
};
```

## How it works

- **Composing scope policy.** Installs a policy on `ToolRegistry` + `ComponentRegistry` that consults a per-`(kind, name)` decision cache.
- **Cache misses.** Default to **allow** (configurable to deny) and fire a background OPA call. Decisions are cached for `cacheTtlMs`.
- **Decision point.** Resolves via the catalog server's `/policy/decide` endpoint (ADR-040 / slice OPA-A) — the actual Rego evaluation lives there, not in the browser.
- **Inspectable.** `OpaAuthorizerService` is a public injectable — call `service.cache()` to inspect decisions, `service.refresh(kind, name)` to force re-evaluation.

## Companion server-side piece

This plugin is the **runtime client**. The catalog server's `/policy/decide` endpoint (slice OPA-A) is the actual Rego evaluation point. Pair this package with a catalog server build that includes the OPA-A slice.

## Full design rationale

- [ADR-040 — OPA policy integration](https://github.com/sahassakhare/agentic-ui/blob/main/docs/adr/0040-opa-policy-integration.md)
- [ADR-010 — Platform principles + Apache 2.0](https://github.com/sahassakhare/agentic-ui/blob/main/docs/adr/0010-platform-principles-and-license.md) (why this lives outside core)

## Compatibility

| Tool | Version |
|------|---------|
| `@infra-tools/agentic-ui` | ≥ 1.2.0 (peer) |
| Angular | 21+ |
| Node.js | ≥ 20.19 |
| TypeScript | 5.9+ |

## License

[Apache 2.0](./LICENSE)
