# Changelog

All notable changes to `@maverick/agentic-ui-server` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`ThreadStateStore<TState>` interface + `InMemoryThreadStateStore` default** — pluggable per-thread state store. Stateful agents (notably `OrchestratorAgent` in the demo) use it to persist sticky-routing state. The default in-memory implementation matches today's behaviour; consumers writing a Redis / Postgres / DynamoDB adapter unblock multi-pod deployments where state must survive a process restart and be shared across replicas. Async-shaped (`get` / `set` / `delete?`) so a real network roundtrip fits naturally. See the [production-deployment cookbook](../../docs/cookbook/production-deployment.md) for adapter sketches.
- **`createSpecialist({ id, factory, description, examples })`** — bundles "construct agent + write `SubAgentSpec`" into one call site. Validates the factory result is a real `ServerAgent`. Returns a structurally-compatible spec usable directly in `OrchestratorAgent`'s `subAgents` config.
- **`registerSpecialists(map, specs)`** — adds each agent to a `Map<string, ServerAgent>` (so each is also reachable via `/agents/<id>/run`) and returns the same array for inline use in the orchestrator config. Cuts ~30 lines of boilerplate per specialist.
- **`SpecialistSpec<TAgent>` type** — public type alias for what `createSpecialist` returns, structurally identical to a hand-written `SubAgentSpec`.

### Notes

- All additions are opt-in and backward-compatible. The `OrchestratorAgent` demo (in `examples/demo-server/`) was refactored to use both helpers, but it's not part of this published library — consumers writing their own LLM-backed `ServerAgent` adopt the helpers as they want.

## [0.1.0]

### Added

- `ServerAgent` interface (yield AG-UI `BaseEvent`s from `run(input, signal)`).
- `AgentResolver` (resolve-by-id from URL path).
- `agUiRouteHandler({ resolver })` — framework-agnostic route handler that wraps any agent's `run()` async iterable as an SSE response, encoded via `@ag-ui/encoder`.
- `EchoAgent` — no-LLM smoke-test agent that streams the user's last message back word-by-word.
- `MemoryStore` — in-memory thread persistence helper.
