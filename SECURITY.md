# Security policy

## Reporting a vulnerability

**Do not report security issues via public GitHub issues.**

If you discover a vulnerability in `@maverick/agentic-ui`, `@maverick/agentic-ui-server`, `@maverick/agentic-ui-mcp`, or any related project under this repository, please report it privately so we can investigate and fix it before it becomes public.

### How to report

- **GitHub Security Advisory** (preferred): [Open a private advisory](https://github.com/sahassakhare/agentic-ui/security/advisories/new). This keeps the discussion private + lets us coordinate disclosure.
- **Email**: as a fallback, send report details to the maintainer email listed in [MAINTAINERS.md](./MAINTAINERS.md). Encrypt with our PGP key (see below) if the report contains sensitive details.

### What to include

- A clear description of the issue.
- A minimal reproduction (code snippet, environment details, attack steps).
- Affected version(s) of the package.
- Suggested mitigation if you have one.
- Your name + how you'd like to be credited (or "anonymous").

## Response timeline

We aim for the following response times. These are best-effort for an open-source project; we'll communicate when something needs longer.

| Stage | Target |
|---|---|
| Initial acknowledgment | 48 hours |
| Triage + severity assessment | 7 days |
| Fix in main + patch release | 30 days for high/critical · 90 days for medium · best-effort for low |
| Public disclosure | Coordinated with reporter; typically 30–90 days after fix |

## Supported versions

We patch security issues on:

- The current minor version (`v1.x` at the time of writing).
- The previous minor version, for 6 months after a new minor ships.

Earlier versions are best-effort only.

## Scope

In scope:

- Code in `projects/agentic-ui/`, `projects/agentic-ui-server/`, `projects/agentic-ui-mcp/`
- Demo applications under `examples/` (lower priority — these are reference apps, not production code)
- Build / CI configuration that affects published packages
- Documentation that could mislead users into insecure configurations

Out of scope:

- Vulnerabilities in third-party dependencies (report those upstream; we'll bump versions when patched)
- Vulnerabilities specific to a deployer's environment that aren't reproducible in a clean install of the lib
- Issues that require a malicious developer to control the host application's source code
- Denial-of-service via expected-but-expensive operations (e.g., running a long-running tool on a slow handler)

## Security expectations of the runtime

The runtime tier (Tier 1 in the [platform plan](./docs/plans/platform-evolution-plan.md)) provides specific guarantees that contributors and adopters should understand:

- **`setScopePolicy` is the trust boundary.** Tools / widgets / forms filtered by scope policy are filtered at the read site — the agent never sees out-of-scope tools. This is enforced before any wire request.
- **The closed-AST predicate evaluator** (F1 composition) is sandboxed: own-property only, allow-listed operators (`===`, `!==`, `&&`, `||`, dotted access, parens, literals), no `eval`, no `Function` constructor.
- **The audit chain** is tamper-evident via FNV-1a `prevHash` + `chainHash`. It is not cryptographically strong against state-actor adversaries — it's designed for tamper-evidence in the operator's own log, not for adversarial proof.
- **LLM-emitted schemas** (e.g., F1\* dynamic forms) are validated through Zod with strict caps before any rendering. Never trust an LLM's output without re-validation at the boundary.
- **Multi-tenancy isolation** is the operator's responsibility today. The control-plane tier (Tier 2) will provide tenant isolation at storage, audit, and observability layers; until then, single-tenant deployments are recommended.

Issues that violate these expectations are in-scope security issues.

## PGP key

A PGP key for encrypted reports will be added here after the first release; until then, prefer GitHub Security Advisories.

## Acknowledgments

We credit reporters who'd like to be credited in release notes + a `SECURITY-ACKNOWLEDGMENTS.md` file (created on first acknowledgment). We don't run a paid bug bounty program at this time.
