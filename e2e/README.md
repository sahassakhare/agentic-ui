# eDiscovery end-to-end tests

Playwright suite that drives the eDiscovery flagship through the
chat shell — one prompt per phase — and asserts on widgets, KPIs,
and the live registry view.

## What's covered

| Spec | What it tests | Needs LLM? |
|---|---|---|
| `00-smoke.spec.ts` | Shell loads · 3 remotes register · 17+ tools · 6 nav routes · chat shell mounts | no |
| `01-collection.spec.ts` | P1 — `addCustodian` + `placeLegalHold` widgets + KPI counts | yes |
| `02-review.spec.ts` | P2 — `searchDocuments` + `markPrivileged`; widget flips to privileged | yes |
| `03-production.spec.ts` | P3 + P5 — `createProductionSet` chain · Productions page · `chainOfCustodyReport` widget · audit integrity badge | yes |
| `04-search.spec.ts` | P4 — `semanticSearch`, `filterByDateRange`, `runTARClassifier` widgets | yes |
| `05-persona-scope.spec.ts` | P7 + P8 — persona-menu tool-count badges · sidebar counter responds to scope policy live · sessionStorage persistence | no |

`needs LLM = no` tests run with the echo-placeholder backend; the
others require a real `GOOGLE_GENERATIVE_AI_API_KEY` in
`examples/demo-ediscovery-server/.env`. LLM-driven specs auto-skip
when `/health` reports `coordinator: 'echo-placeholder'`.

## Run

### Local — recommended

Have the five services already running (the `npm run` scripts you'd
use for development): `demo-ediscovery-shell`, the three remotes,
and the agent server. Then:

```bash
npm run test:e2e:install      # one-time — chromium only
npm run test:e2e              # runs all 16 tests
```

The Playwright config detects already-bound ports and skips
spawning. Avoids the cold-start lottery on Gemini's quota.

### Headed / debugging

```bash
npm run test:e2e:ui           # Playwright UI mode — best for triage
npm run test:e2e -- --headed  # watch the browser
npm run test:e2e -- --debug   # step through with the inspector
```

### CI

```bash
CI=true npm run test:e2e
```

The config's `webServer` block spawns all five services from scratch;
needs ~60s warm-up. JUnit XML lands at `e2e/results/junit.xml`.

## Filtering

```bash
# A single phase
npm run test:e2e -- specs/01-collection.spec.ts

# Phases without LLM only (fast smoke pass, ~15s total)
npm run test:e2e -- specs/00-smoke.spec.ts specs/05-persona-scope.spec.ts

# A single test by name
npm run test:e2e -- -g "add a custodian"
```

## Architecture

- **Serial within file.** Each spec's tests share state — the second
  collection test depends on a custodian created by the first. We
  set `test.describe.configure({ mode: 'serial' })` so a failure
  short-circuits the rest of the file.
- **No fully-parallel runs across files.** The agent server keeps
  per-thread state in memory; spawning 4 worker browsers fighting
  the same matter would be a bad time. `workers: 1` in the config.
- **`page-object`-style helpers** under `support/`:
  - `chat.ts` — `chatShell(page)` wraps `<mvk-chat-shell>` so
    specs read like `chat.ask(...)` / `chat.waitForWidget(...)`.
  - `persona.ts` — `personaMenu(page)` opens the avatar dropdown
    and reads tool-count badges per role.
  - `sidebar.ts` — `sidebar(page)` taps the live registry counts
    in the left rail's footer.
- **Widget-first assertions.** We assert the demo's actual widget
  selectors (`app-custodian-card`, `app-document-preview`,
  `app-production-summary`, `app-chain-of-custody-report`, …)
  rather than the LLM's prose, which varies between turns.

## Environment overrides

| Variable | Default | Use |
|---|---|---|
| `EDIS_BASE_URL` | `http://localhost:4300` | Point the suite at a different host / port |
| `EDIS_SERVER`   | `http://localhost:4311` | Agent-server URL used by `isCoordinatorLLMReady` |
| `CI`            | unset                    | Triggers `webServer` spawn + JUnit reporter + retries |

## Known limitations

- **Gemini free-tier daily quota.** `gemini-3-flash` is capped at
  **20 requests/day** on the free tier. The 9 LLM-driven tests can
  burn through that in ~2 full suite runs (each `chat.ask()` =
  1 request, plus orchestrator routing turns). When the quota is
  exhausted every LLM spec fails with a 429 RESOURCE_EXHAUSTED in
  the chat transcript — the suite isn't broken, the API is. Either
  upgrade to a paid tier (`gemini-2.5-flash` paid is much higher),
  wait for the daily reset, or run only the LLM-free specs:
  `npm run test:e2e -- specs/00-smoke.spec.ts specs/05-persona-scope.spec.ts`.
- **LLM nondeterminism.** Gemini sometimes runs partial chains, asks
  for confirmation, or restates the prompt back. Specs assert on
  the *first* widget that lands, not on the chat text. If a test
  flakes intermittently, widen the `waitForWidget` timeout rather
  than tightening the assertion.
- **No state reset between tests.** The mock data layer is in-memory
  on the server. Tests that mutate state (custodian add, hold place,
  production create) run additively — running the same test twice
  is fine but the resulting state persists until the server restarts.
- **Tool-filter side-effect.** Phase 4 activates `keywordToolFilter`
  with a top-12 budget; if the LLM doesn't see the tool it needs, a
  test fails. Specs use prompts crafted to hit the filter's signal
  ("project phoenix", "TAR classification", etc.). If you change the
  prompt copy, re-run the affected spec.
