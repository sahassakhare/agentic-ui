# Governance

This project is open-source under Apache 2.0 ([LICENSE](./LICENSE)) and governed in the open. This document describes how decisions are made, who makes them, and how that evolves over time.

The governance model is intentionally lightweight at this stage. As the contributor base grows, we expect to evolve from single-vendor stewardship to a hybrid TSC, and eventually pursue foundation-track governance (CNCF or OpenJS) once adoption justifies it. The trajectory is documented in [docs/plans/platform-evolution-plan.md](./docs/plans/platform-evolution-plan.md) §5.

---

## Current model: single-vendor stewardship with public TSC

### Roles

**Contributors** — anyone who opens an issue, PR, or RFC. No formal status; no contract; the [DCO sign-off](./CONTRIBUTING.md#developer-certificate-of-origin-dco) on each commit is the only commitment we ask for.

**Committers** — contributors with merge rights to the main repos. Earned through sustained, high-quality contributions reviewed by the TSC. Listed in [MAINTAINERS.md](./MAINTAINERS.md). Each committer owns one or more areas (e.g., runtime, MCP adapter, federation, control plane).

**Technical Steering Committee (TSC)** — small group (target: 3–5) responsible for technical direction, architectural decisions that span multiple areas, RFC review, release management, and conflict resolution. Listed in [MAINTAINERS.md](./MAINTAINERS.md). At project inception, the TSC is mostly internal; we plan to add 1–3 external seats by month 12 once external committers materialize.

### Decision-making

Decisions flow through the lightest mechanism that fits the change:

| Type of decision | Mechanism | Quorum |
|---|---|---|
| Bug fix, doc edit, internal refactor (non-breaking) | PR + 1 committer approval | n/a |
| Security-sensitive change (registry-base, audit chain, scope policy, federation runtime) | PR + 2 committer approvals | n/a |
| New public API, breaking change, registry-shape change | RFC + 7-day public comment + TSC approval | majority of TSC |
| Cross-cutting strategic change (license, governance, sustainability model) | TSC vote with explicit minutes published | majority of TSC |
| Release cut (minor + major) | Maintainer-led; TSC informed | n/a (TSC veto possible for breaking changes) |

When TSC votes are required, they're conducted publicly in the relevant issue or RFC thread. Minutes for off-thread strategic discussions are published in `docs/governance/minutes/YYYY-MM-DD.md`.

### Conflict resolution

If contributors disagree on a technical decision and discussion in the issue/RFC doesn't reach consensus:

1. The TSC chair calls for explicit positions from each side.
2. If consensus still doesn't emerge, the TSC votes; majority wins.
3. Dissenting positions are documented in the relevant ADR for the historical record.

If the conflict involves conduct rather than technical disagreement, the [Code of Conduct](./CODE_OF_CONDUCT.md) enforcement process applies.

---

## RFC process (for substantive changes)

Modeled after Rust / React / TC39. Required for all changes listed in the [CONTRIBUTING.md "RFC process" section](./CONTRIBUTING.md#rfc-process-for-substantive-changes).

### Lifecycle

1. **Pre-RFC issue** — open an issue describing the problem and high-level proposed direction. Tag `rfc-needed`. Discuss until rough shape is agreed.
2. **Draft RFC** — copy `docs/rfcs/0000-template.md` to `docs/rfcs/####-short-name.md` (number = next available). Open a PR.
3. **Public comment** — RFC PR sits open ≥7 days. Comments and revisions land as PR commits.
4. **TSC review** — TSC discusses + votes. Decision documented in the PR description (`approved`, `revisions-requested`, `withdrawn`).
5. **Merge** — accepted RFCs merge as `accepted`. The RFC document remains in `docs/rfcs/` as a permanent design record.
6. **Implementation** — separate PRs reference the RFC. Implementation may diverge from the RFC for pragmatic reasons; significant divergence requires an RFC amendment.

### What goes in an RFC

- Motivation: what problem does this solve, what's the gap in current capabilities
- Proposed design: API shape, data flow, interaction with existing systems
- Alternatives considered: at least 2; explain why they were rejected
- Backward-compatibility: explicit statement, with migration path if breaking
- Open questions: things to resolve during implementation

### What does **not** require an RFC

- Bug fixes that don't change public API
- Performance optimizations that don't change behavior
- Documentation improvements
- Internal refactors that don't change public behavior
- Adding test coverage
- Capability additions in demo apps (those are reference code, not lib API)

---

## Releases

### Versioning

[Semantic Versioning 2.0](https://semver.org/spec/v2.0.0.html) for all `@infra-tools/*` packages.

- **Major (X.0.0)** — breaking changes. Avoided per [ADR-010](./docs/adr/0010-platform-principles-and-license.md) (P2: zero breaking changes through v1.x). Major bumps require RFC + community-process notice ≥30 days.
- **Minor (1.X.0)** — new features, additive changes only. RFCed for substantive features; non-RFC for additive convenience APIs.
- **Patch (1.x.X)** — bug fixes, internal improvements, dependency bumps.

### Release cadence

- **Patch releases** — as needed; typically weekly or when critical fixes land.
- **Minor releases** — monthly cadence target; quarterly minimum.
- **Major releases** — only when forced (Angular major version bumps, runtime ecosystem breaks, etc.). Aim: avoid through end of v1.x.

### Release process

1. PR bumps `package.json` version + adds `CHANGELOG.md` entry.
2. PR merges; tag is created on `main` (`v<package>-<version>`).
3. CI publish workflow ([`.github/workflows/publish.yml`](./.github/workflows/publish.yml)) publishes to npm.
4. Release notes posted on GitHub release.

---

## Foundation track (deferred)

We plan to evaluate foundation-track governance (CNCF Sandbox or OpenJS Incubation) at year 2, once:

- The contributor base has ≥10 active external committers
- Adoption signals justify the foundation overhead
- Sustainability is sufficient to absorb foundation-fee + governance time costs

Until then, this project remains under single-vendor stewardship as defined above. The decision to pursue foundation track is a TSC vote (per the table above).

---

## Trademark policy

The names `@maverick`, `agentic-ui`, `agentic-ui-server`, `agentic-ui-mcp`, and the Maverick logo (when one exists) are trademarks of the project. Forks and derivative works are welcome under the [Apache 2.0 license](./LICENSE), but may not use these names or marks in ways likely to confuse users about the source of the software.

We follow a Sentry-style trademark policy (permissive about technical use, strict only about consumer confusion), not a MongoDB-style policy (broad enforcement). If your fork or derivative wants to use the marks, open an issue and we'll work out terms.

---

## Amendments

This document is amended through the standard PR process for documentation, with one exception: changes to the decision-making mechanisms themselves (the table in this section) require a TSC vote, not just a maintainer approval.

Major restructures of governance (e.g., moving to a foundation, splitting the TSC, changing the role taxonomy) require RFC + 30-day public comment + TSC supermajority (4 of 5 if TSC is sized at 5).
