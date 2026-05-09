# Contributing to @maverick/agentic-ui

Thanks for your interest in contributing. This project is the **runtime tier** of an open-source three-tier agentic-UI platform (see [docs/plans/platform-evolution-plan.md](./docs/plans/platform-evolution-plan.md) for the full picture). Everything here is Apache 2.0, governed in the open, and built around two non-negotiable principles:

1. **Embedded-first defaults** — the lib must run end-to-end in one browser tab with zero external dependencies. Every external integration is opt-in.
2. **No breaking changes** — every public API in v1.x must keep working forever.

Both are codified in [ADR-010](./docs/adr/0010-platform-principles-and-license.md) and govern every PR.

---

## Quick start

```bash
git clone https://github.com/sahassakhare/agentic-ui.git
cd agentic-ui
npm ci --no-audit --fund=false
npm run build:lib
npx ng test agentic-ui --no-watch
```

If `npm ci` fails with peer-dep errors, the repo's `.npmrc` should be picked up automatically (`legacy-peer-deps=true`). If not, your npm version may be too old; we pin to npm `11.6.2` in CI.

---

## Ways to contribute

| Contribution | What it looks like |
|---|---|
| **Bug report** | Open an issue using the bug-report template. Include reproduction, expected vs. actual, environment (Node + npm + Angular). |
| **Feature request** | Open an issue using the feature-request template. Describe the use case, the gap in current capabilities, and any prior art. **Substantive features (new public APIs) require an RFC** — see below. |
| **Documentation fix** | Open a PR directly. No RFC needed. |
| **Capability authoring** (new tools, widgets, forms via the demo apps) | Open a PR. Add a cookbook entry if the pattern is novel. |
| **Bug fix (non-breaking)** | Open a PR with a regression test. Reference the issue in the description. |
| **New public API / breaking change** | **RFC required.** See [docs/rfcs/](./docs/rfcs/) for the template + active RFCs. |

---

## RFC process (for substantive changes)

Inspired by Rust / React / TC39. Required for:

- New public APIs in `@maverick/agentic-ui`, `agentic-ui-server`, or `agentic-ui-mcp`
- Changes to `RegistryBase<TDef>` semantics
- New cross-cutting injection tokens
- Changes to the audit chain shape
- Anything that touches `setScopePolicy`, multi-tenancy, or compliance-relevant code

Process:

1. Open an issue describing the problem + proposed solution at high level. Tag it `rfc-needed`.
2. After discussion, draft an RFC under `docs/rfcs/####-short-name.md` using the template (see existing RFCs).
3. Open a PR with the RFC. RFC sits open ≥7 days for community feedback.
4. After consensus + maintainer approval, RFC merges as `accepted`. Implementation PRs reference the RFC.

For non-substantive changes (bug fixes, doc updates, internal refactors), skip the RFC and open a PR directly.

---

## Pull requests

### Before you open a PR

- ✅ Run `npx ng test agentic-ui --no-watch` and confirm 287/297 pass (10 schematics tests pre-fail without `npm run build:schematics`).
- ✅ Run `npx ng build agentic-ui` and confirm no errors.
- ✅ If touching capability code in any demo, run the relevant Playwright spec.
- ✅ If touching public APIs, update [`projects/agentic-ui/CHANGELOG.md`](./projects/agentic-ui/CHANGELOG.md) under `## [Unreleased]`.
- ✅ Verify the bundle-size guard in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) won't trip (FESM cap is 300 KB).

### PR description requirements

- Reference the issue / RFC the PR addresses (`Closes #123`).
- One-paragraph summary of the change and why it's needed.
- Test plan: what you did to validate the change works.
- Backward-compatibility note: confirm no breaking change, or call out the breaking change with migration path + RFC link.

### Review process

- 1 maintainer approval required for non-security-sensitive paths.
- 2 maintainer approvals required for: registry-base.ts, audit chain, scope policy, federation runtime, control-plane integration points.
- CI must pass before merge (Build + test on Node 20.19, TypeDoc site, federation builds, lib unit tests).
- Squash-merge by default; merge commits only for RFC implementation PRs that span multiple meaningful commits.

---

## Developer Certificate of Origin (DCO)

We use the **Developer Certificate of Origin** rather than a Contributor License Agreement. Every commit must be signed off:

```bash
git commit -s -m "fix(lib): handle empty composition arrays"
```

This appends a `Signed-off-by: Your Name <your.email@example.com>` line, certifying that you wrote the contribution and license it under the project's Apache 2.0 license. The full DCO text is at [https://developercertificate.org/](https://developercertificate.org/).

We do **not** require a CLA. DCO sign-off is enough.

---

## Coding conventions

- **TypeScript strict mode.** No `any` outside of clearly-isolated boundaries (e.g., third-party API responses pre-validation).
- **Zod for runtime schemas.** Every public-facing prop / arg gets a Zod schema; never trust LLM-emitted values without validation.
- **Signals over RxJS.** Angular signals are the default reactive primitive; RxJS only at framework boundaries (HttpClient, etc.).
- **No `eval`, no `new Function`.** The closed-AST DSL evaluator (F1 predicate evaluator) is the only place expression evaluation happens, and that's a sandbox by design.
- **No comments on the obvious.** A line of code that explains itself doesn't need a comment. Comments earn their place by explaining *why*, not *what*.
- **Test conformance per registry.** Every new registry must add itself to the conformance test suite. No registry-specific exception paths in shared tests.

Lint + format runs in CI; pre-commit hooks recommended (`husky` + `lint-staged` if you want them).

---

## Commit messages

Conventional Commits. Format: `type(scope): description`

Common types we use:
- `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `ci`

Common scopes:
- `lib`, `ediscovery`, `mcp`, `server`, `tooling`, `deps`, `release`

Example: `feat(lib): add RegistryProviderHook for opt-in external state mirror`

The `Co-Authored-By:` trailer is welcome (and used heavily in this repo's history).

---

## Security

**Do not file security issues publicly.** See [SECURITY.md](./SECURITY.md) for the disclosure policy and contact.

---

## Code of conduct

Everyone interacting in this project (issues, PRs, discussions, Discord) agrees to abide by [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). It's the Contributor Covenant 2.1.

---

## Governance

Project decisions flow through the Technical Steering Committee (TSC). See [GOVERNANCE.md](./GOVERNANCE.md) for the current model + decision process.

---

## Maintainers

Active maintainers are listed in [MAINTAINERS.md](./MAINTAINERS.md), along with their areas of ownership.

---

## License

Apache License 2.0 — see [LICENSE](./LICENSE). All contributions are accepted under the same license via DCO.
