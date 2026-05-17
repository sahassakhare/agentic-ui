# @infra-tools/agentic-ui

[![npm](https://img.shields.io/npm/v/@infra-tools/agentic-ui.svg)](https://www.npmjs.com/package/@infra-tools/agentic-ui)
[![Angular](https://img.shields.io/badge/angular-21-DD0031?logo=angular&logoColor=white)](https://angular.dev)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)

A reusable Angular 21 library for building user interfaces an LLM can drive — one chat shell, one set of registries, one orchestration loop. Works against **AG-UI**, **Hashbrown**, or **A2UI** without rewriting application code.

> An **agentic UI** lets the LLM decide three things per turn — which tool to call against your backend, which UI component to render in response, and when to stream more text vs. call another tool. This library is the plumbing that makes those decisions resolve to typed handlers and registered Angular components, with federated MFE remotes contributing tools and widgets at runtime.

**Full docs, diagrams, demos, and ADRs:** https://github.com/sahassakhare/agentic-ui

## Install

```bash
npm install @infra-tools/agentic-ui
ng add @infra-tools/agentic-ui --backend=ag-ui
```

`ng add` patches `app.config.ts` with `provideAgenticUi()` plus the chosen backend provider, scaffolds `src/app/agentic/{tools,widgets}.ts`, and adds the required peer dependencies.

## Minimum-viable wiring

```ts
// src/app/app.config.ts
import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideAgenticUi, provideAgUiBackend } from '@infra-tools/agentic-ui';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideAgenticUi(),
    provideAgUiBackend({ url: 'http://localhost:4111/agents/gemini/run' }),
  ],
};
```

```ts
// src/app/app.ts
import { Component } from '@angular/core';
import { ChatShellComponent } from '@infra-tools/agentic-ui';

@Component({
  selector: 'app-root',
  imports: [ChatShellComponent],
  template: '<mvk-chat-shell />',
})
export class App {}
```

That's a working chat UI talking to an AG-UI backend. For real tools + widgets + federation, follow the [User Guide](https://github.com/sahassakhare/agentic-ui/blob/main/docs/USER_GUIDE.md).

## What's inside

| Area | Surface |
|------|---------|
| **Chat shell** | `<mvk-chat-shell>` + composer + thread view + multi-modal attachments |
| **Widget container** | `<mvk-widget-container>` resolves component names from `ComponentRegistry` and mounts via `*ngComponentOutlet` with Zod-validated props |
| **Form renderer** | `<mvk-form-renderer>` drives schema-driven dynamic forms (`agenticForm` factory) with composable sections + reactive predicates |
| **15 registries** | Tool · Component · Capability · Backend · MFE · Action · Intent · Form · DataSource · **Approval (F4)** · **Operation (F5)** · Validation · Persistence · Layout · SchemaTransformer — all uniform `register / list / signal / removeBySource / setScopePolicy` |
| **Orchestration loop** | `injectAgenticChat()` · `runUntilSettled` · abort signals · turn lifecycle hooks |
| **Backend adapters** | `provideAgUiBackend` · `provideHashbrownBackend` · `provideA2uiBackend` — swap by config |
| **Federation** | `defineCapabilityModule` + `loadRemoteCapabilities` (Native Federation) / `loadRemoteCapabilitiesMF` (webpack MF). Remotes contribute tools + widgets at runtime |
| **Platform integration** | `provideAgenticPlatform({...})` — IAM persona, MFE registry, capability registrar / authorizer, usage metering through one composite provider |
| **Schematics** | 10 generators: `ng add`, `tool`, `widget`, `chat-shell`, `backend`, `agent-server`, `mfe-capability`, `action`, `intent`, `form` |

## Key seams

- **Pluggable backends.** Single `AgenticBackend` interface. AG-UI is the default; Hashbrown + A2UI ship as alternatives. Bring-your-own protocol is a 50 LOC adapter.
- **Registry uniformity.** All 15 registries inherit one base class. Adding your own (e.g. `MetricRegistry` for a custom domain) is ~30 LOC of base-class extension.
- **Federation-safe single primary entry.** All public API exports through one entry point so Native Federation can share the runtime as a singleton across host and remote ([ADR-005](https://github.com/sahassakhare/agentic-ui/blob/main/docs/adr/0005-single-primary-entry.md)). Tree-shaking is preserved by `"sideEffects": false`.
- **Persona scope.** `RegistryBase.setScopePolicy(predicate)` filters every `list / get / signal` read uniformly. The LLM's tool list, the widget container's resolution, and the form renderer's available shapes all honour the same policy.
- **Zero breaking changes through v1.x.** [ADR-010](https://github.com/sahassakhare/agentic-ui/blob/main/docs/adr/0010-platform-principles-and-license.md) codifies the guarantee.

## Companion packages

| Package | What it adds |
|---|---|
| [`@infra-tools/agentic-ui-server`](https://www.npmjs.com/package/@infra-tools/agentic-ui-server) | Server-side helpers — generic Agent interface + AG-UI SSE route handler |
| [`@infra-tools/agentic-ui-mcp`](https://www.npmjs.com/package/@infra-tools/agentic-ui-mcp) | Wrap any `ToolDef[]` as an MCP server for Claude Desktop / Cursor / Zed |
| [`@infra-tools/agentic-ui-copilot-skill`](https://www.npmjs.com/package/@infra-tools/agentic-ui-copilot-skill) | GitHub Copilot Extensions webhook adapter |
| [`@infra-tools/agentic-ui-teams-bot`](https://www.npmjs.com/package/@infra-tools/agentic-ui-teams-bot) | Microsoft Teams Bot Framework adapter — Adaptive Cards in Teams chat |
| [`@infra-tools/agentic-ui-copilot-studio-connector`](https://www.npmjs.com/package/@infra-tools/agentic-ui-copilot-studio-connector) | Microsoft Copilot Studio Connector — catalog tools as Power Platform actions invocable from M365 Copilot |

## Demos

The repo ships **sixteen reference applications** under `examples/`, including a flagship enterprise eDiscovery reference that exercises every load-bearing library feature simultaneously (federation, multi-agent orchestration, MCP, all 15 registries, tamper-evident audit chain, persona-scoped permission filtering). See [README → Demo applications](https://github.com/sahassakhare/agentic-ui#demo-applications) for the full list, ports, and a one-command quickstart for each.

## Peer dependencies

| Peer | Required? | Used when |
|------|-----------|-----------|
| `@angular/common` `^21.2.0` | yes | always |
| `@angular/core` `^21.2.0` | yes | always |
| `rxjs` `~7.8.0` | yes | always |
| `zod` `^3.23.0` | yes | always |
| `@angular/forms` | optional | importing `<mvk-form-renderer>` |
| `@ag-ui/client` | optional | importing `provideAgUiBackend` |
| `@module-federation/runtime` | optional | webpack MF (`loadRemoteCapabilitiesMF`) |
| `@opentelemetry/api` | optional | OpenTelemetry telemetry sink |

## Compatibility

| Tool | Version |
|------|---------|
| Angular | 21+ |
| Node.js | ≥ 20.19 |
| TypeScript | 5.9+ |

## License

[Apache 2.0](./LICENSE)
