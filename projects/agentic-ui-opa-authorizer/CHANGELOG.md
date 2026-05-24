# Changelog

All notable changes to `@infra-tools/agentic-ui-opa-authorizer` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.4]

### Fixed

- **Reactive decision propagation.** A background OPA decision that flipped to *deny* after the first `onMiss: 'allow'` read did **not** hide the tool/component — the registry's filtered `computed` never re-evaluated because the scope policy read a plain `Map`, and the provider's `effect` reading the registry signals was a no-op for propagation (reading a signal in an effect doesn't invalidate its other consumers). `OpaAuthorizerService.decide` now reads the `cacheVersion` signal, so every registry `computed` that runs the policy tracks it and re-evaluates the moment a decision lands. Removed the misleading no-op `effect`. Covered by a new reactivity regression test.
