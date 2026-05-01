# Registries vs. industry — comparison and integration map

We ship 13 registries (`Tool`, `Component`, `Capability`, `Backend`,
`MfeRegistry`, `Action`, `Intent`, `Form`, `DataSource`, `Validation`,
`Persistence`, `Layout`, `SchemaTransformer`). Before we take decisions
about extending or trimming the set, this doc grounds the design
against production systems with comparable shapes.

## Two reference categories

### Agentic / LLM-tooling SDKs (narrow surface)

Designed around "talk to one LLM, expose tools." UI is mostly out of
scope.

| System | Their registries (analogues to ours) | What they don't have |
|---|---|---|
| **OpenAI Assistants API** | Tools (server-side functions), Files, Threads | No client-side widget rendering, no federation, no UI primitives |
| **LangChain / LlamaIndex** | Tools, Memory, VectorStore, LLM, ChatModel, Prompt templates | UI is out-of-scope; framework-agnostic glue, not an Angular library |
| **Vercel AI SDK** | Tools, Providers (LLM backends), Streaming hooks | Single-app focus; no MFE story |
| **CopilotKit** | Actions (= our Tools), Generative UI components, CopilotProviders | Closest peer to us by surface; ~5 registry equivalents. Scoped to React + their hosted runtime |

**Read**: in this category we look heavy because we cover ground
(forms, actions, intents, layout, persistence) the agent-SDK category
usually punts on. The user-domain features we built (Action / Form /
DataSource / Intent / Layout) are honest answers to "what would an
Angular app *also* want from the agent layer."

### Mature plugin / extension platforms (broad surface)

Designed around "many teams contribute features at runtime." Here our
13 registries look **small**.

| System | Their registries / extension points | Patterns adopted today |
|---|---|---|
| **VS Code extensions** | ~50+ contribution points: commands, languages, keybindings, views, themes, debuggers, problemMatchers, snippets, taskDefinitions… | Manifest-only registration (`package.json contributes`), lazy activation on event, registry-per-namespace |
| **Backstage** (Spotify's developer portal) | API extensions, plugins, routes, scaffolder actions, catalog kinds, permission policies — 30+ | Plugin-as-package, capability manifest, federation-style isolation, health probes per plugin |
| **WordPress** | Hooks (actions), Filters, Shortcodes, Widgets, Sidebars, Custom Post Types, REST endpoints — 20+ extension points | Runtime registration, name-based dispatch |
| **Eclipse / Theia / IntelliJ** | Hundreds of extension points (decades old) | Service registry, contribution scoping. We don't need the full surface |

**Read**: production plugin platforms typically have 2–5× more
registries than us. The structure scales fine.

## Honest assessment of the count

We're not over-engineered. The closest comparable system (CopilotKit)
has ~5 registry equivalents and will eventually hit the same growth
pressure once it broadens beyond actions+UI. Mature analogues
(VS Code, Backstage) have many more. The reason 13 *feels* like a lot
is that the agent-SDK comparison is narrow by intent — they delegate
UI to their host; we don't.

## What production deployments of *our shape* actually worry about

Once you have multiple teams contributing remotes via
`defineCapabilityModule`, registry **count** stops mattering and
**governance** becomes the thing that bites:

| Concern | What VS Code / Backstage do | What we have | Gap |
|---|---|---|---|
| **Conflict resolution** — two remotes register `bookFlight` | First-write-wins or namespace-by-package | Currently silent — second `register()` overwrites the first | Need a `conflictPolicy: 'replace' \| 'throw' \| 'first-wins' \| 'namespace'` option on the registry |
| **Permission scopes** — should the loyalty remote be allowed to register a tool that mutates payments? | Manifest declares scopes; runtime enforces | **Shipped** — `RegistryEntry.scopes?: readonly string[]` + `RegistryBase.setScopePolicy(policy)`. Filters every `list()` / `get()` / `signal()` read. See [ADR-008](../adr/0008-registry-scope-policy.md), `eDiscovery shell` migration. | — |
| **Versioning** — bookings@v1 in use while v2 rolls out | Compatibility ranges in plugin manifest | `MfeRegistryClient` carries `version` but no range matching | `requiredHostVersion` field; `register()` skips/throws on mismatch |
| **Activation events** — load remote only when the user navigates to its area | VS Code `activationEvents` field | `prefetchCapabilities` exists; lazy-hydrate is informal | New helper: `provideRemoteActivation({ remote, on: routerEvent | userEvent | timer })` |
| **Lifecycle hooks** — graceful teardown when a remote unloads | `deactivate()` hook | `removeBySource` (data-only); no callback for the remote to clean up | `RegistryEntry.onDispose?: () => void`; called from `removeBySource` |
| **Health probes** — is bookings remote OK? | Periodic ping in Backstage | `RemoteSpec.healthStatus` field exists, no consumer | Periodic poller + typed accessor on `CapabilityRegistry` |
| **Telemetry per plugin** — which plugin spent how much time / threw errors | OTel spans tagged with plugin id | `AgenticTelemetrySink` + `source: 'remote:<name>'` on every entry | Already supported — needs a dashboard, not more code |

## Integration map — how each gap fits onto our current code

The structural payoff: every governance feature lands either on the
shared `RegistryBase<TDef>` (so all 13 inherit at once) or on an
adjacent provider — none requires reshaping the registries.

| Gap | Where it lands | Code surface | Backwards compat |
|---|---|---|---|
| **Conflict resolution** | `RegistryBase.register()` + new `RegistryOptions { conflictPolicy }` constructor arg | Single method change in [`registry-base.ts`](../../projects/agentic-ui/src/lib/registries/registry-base.ts); current behaviour stays the default | ✓ default `'replace'` matches today |
| **Scopes** ✅ shipped | `RegistryEntry.scopes?: readonly string[]` + `RegistryBase.setScopePolicy(policy)` filtering `list()` / `get()` / `signal()` reads. `permissiveScopePolicy` is the default; `activeScopePolicy(getter)` is the convenience export. `getRaw` / `listRaw` bypass for tooling. See [ADR-008](../adr/0008-registry-scope-policy.md). | Type extension + filter on read; eight unit tests | ✓ default policy shows everything; consumers without `setScopePolicy` see no behaviour change |
| **Versioning** | `RegistryEntry.requiredHostVersion?: string` (semver range); `register()` reads `package.json` once and skips on mismatch | Type extension + one-line check in `register()` | ✓ omit field = registers always |
| **Activation events** | NEW provider `provideRemoteActivation({ remote, on, ... })` that listens to Router / signal / timer events and calls `loadRemoteCapabilities` lazily | Standalone helper alongside `loadRemoteCapabilities`; doesn't touch `RegistryBase` | ✓ purely additive |
| **Lifecycle hooks** | `RegistryEntry.onDispose?: () => void \| Promise<void>`; called from `removeBySource()` before deletion | Two lines in `removeBySource` + type extension | ✓ omit hook = no callback fires (current behaviour) |
| **Health probes** | New `MfeRegistryClient.startHealthPolling({ intervalMs, onDegraded })` helper; pushes `healthStatus` updates into `CapabilityRegistry` signal | New method; pure addition; default is no polling | ✓ |
| **Telemetry visualisation** | No code — wire `AgenticTelemetrySink` to OTel collector + dashboard | Cookbook entry, demo dashboard | ✓ |

## Recommended ordering if we ship the integration

Three of the gaps are surface bugs (silent footguns); the others are
features. If we ship them, do the bugs first.

1. **Conflict resolution** — only the silently-wrong one. A remote
   registering a duplicate name today wins by accident of load order;
   that's not a behaviour anyone wants. ~half day to ship with default
   `'replace'` (no breakage) plus opt-in `'throw'` and `'namespace'`.
2. **Lifecycle `onDispose` hooks** — completes the federation
   teardown story. `removeBySource` exists; this just lets the *remote*
   participate in its own cleanup. ~half day.
3. **Activation events provider** — makes capability prefetch a
   complete story. Today consumers must hand-roll the
   prefetch-then-hydrate flow; this provider gives a one-liner. ~1 day.
4. **Versioning + scopes** — only justified once we hear concrete
   complaints from a 5+ team deployment. Premature otherwise.
5. **Health polling** — same: nice-to-have until a remote actually
   goes degraded in production.

## Top-level recommendation

**Don't add more registries.** The 13 we have cover the conceptual
ground. Add **governance hooks on the existing `RegistryBase`** when
real teams report friction:

- Ship #1 (conflict policy) and #2 (`onDispose`) now if any consumer
  is going to ship more than two MFE remotes.
- Ship #3 (activation provider) the moment a deployment has 10+ remotes.
- Ship #4–#5 only when a real production deployment asks for them.

The registry count is fine. The remaining work is on the seam between
registries and the federation runtime, which is where the real
production scale problems show up.

## Resources

- [Production deployment](../cookbook/production-deployment.md) — `ThreadStateStore` is item-#1 of the same governance class for *server*-side state.
- [Federation at scale](../cookbook/federation-at-scale.md) — capability prefetch + tool filter, the federation-side counterpart.
- [ADR-002 — Layered registry system](./../adr/0002-layered-registry-system.md) — the original 13-registry decision.
