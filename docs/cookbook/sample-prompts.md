# Sample prompts — what to type into each demo

Canonical prompts grouped by **demo app** and by **library feature**.
Use them as your first manual test after starting a demo, or as the
basis for a regression suite.

> All prompts assume the agent server is running with a Gemini API key
> configured in `examples/demo-server/.env`. Demos that don't need an
> LLM (echo agent only) are flagged.

## Quick reference — by demo app

### `demo-monolith` (port 4202)

Single-domain, single-agent app. Connects to `/agents/gemini/run`. One
tool (`bookFlight`) and one widget (`flightCard`).

| Prompt | What happens | Demonstrates |
|---|---|---|
| *"Book a flight from LAX to JFK on 2026-05-05"* | Agent calls `bookFlight`, host renders `flightCard` widget under the tool result | `ToolRegistry`, `ComponentRegistry`, generative UI |
| *"What's the booking id for the flight you just booked?"* | Agent recalls the previous tool result, replies in text | Multi-turn memory, tool-result feedback loop |
| *"Cancel that booking"* | Agent has no `cancelFlight` tool — explains the limitation | Bounded tool surface; LLM doesn't hallucinate tools |

### `demo-multi-agent` (port 4204)

One host, three specialists, orchestrator on the server. All tools and
widgets registered inline (no federation).

| Prompt | Routes to | Renders |
|---|---|---|
| *"Book a flight from LAX to JFK on 2026-05-05"* | bookings | `flightCard` |
| *"How many loyalty points do I have?"* | loyalty | `pointsCard` |
| *"Open a support ticket — my refund hasn't arrived"* | support | `ticketCard` |
| *"What's the airspeed velocity of an unladen swallow?"* | none | Fallback "I'm not sure which specialist to involve" message |

**Cross-domain follow-ups** (testing the sticky-by-thread router):

| First | Second | Expected |
|---|---|---|
| *"Book LAX→JFK"* | *"on May 5 2026"* | Stays with bookings (clarification, not a domain switch) |
| *"How many points do I have?"* | *"And open a ticket about my missing miles"* | Re-classifies to support on the second turn |
| *"Book a flight to JFK"* | *"What time is it?"* | Re-classifies; current specialist is unrelated to time, falls back to "none" |

### `demo-shell` + `demo-remote-{bookings,loyalty,support}` (port 4200)

Federated host. Same prompts as `demo-multi-agent`, but tools/widgets
are contributed at runtime by the three remotes on `:4201`/`:4203`/`:4205`.

| Prompt | Routes to | Owned by |
|---|---|---|
| *"Book a flight from LAX to JFK on 2026-05-05"* | bookings specialist | `demo-remote-bookings` |
| *"Redeem 25,000 points for a flight"* | loyalty specialist | `demo-remote-loyalty` |
| *"Check status of ticket TICK-AB12CD"* | support specialist | `demo-remote-support` |

**Federation-specific tests**:

| Action | Expected |
|---|---|
| Kill `demo-remote-loyalty` (`kill $(lsof -nP -iTCP:4203 -sTCP:LISTEN -t)`), reload host | Header drops to `4 tool(s) across 2 remote(s)` |
| Type *"How many points do I have?"* with loyalty remote down | Orchestrator routes to loyalty but the tool isn't in the registry — agent explains it cannot perform the action |
| Restart loyalty remote, reload host | Header recovers to `5 tool(s) across 3 remote(s)` |

### `demo-feature-tour` (port 4206)

Extended-registry showcase: ActionRegistry, FormRegistry, DataSourceRegistry,
IntentRegistry. Connects to `/agents/gemini/run`.

| Prompt | Tool fires | Registry consulted | What you see |
|---|---|---|---|
| *"Take me to the dashboard"* | `navigateTo` | `ActionRegistry.get('navigate')` → `Router.navigateByUrl('/dashboard')` | URL changes, tiny "Navigated to /dashboard" confirmation card in chat |
| *"Show a success toast saying my booking is confirmed"* | `showToast` | `ActionRegistry.get('showToast')` → `ToastService.show(...)` | Green toast at bottom-right |
| *"Show a warning toast saying my session expires soon"* | `showToast` (level: warn) | same | Orange toast |
| *"Look up user U-1042"* | `lookupUser` | `DataSourceRegistry.get('users').adapter({path})` | `userInfoCard` widget renders user info from the typed REST adapter |
| *"Look up user U-9999"* | `lookupUser` | same | Different user, demonstrating the data source isn't hard-coded to one id |
| *"Edit my profile, set the email to new@example.com"* | `editProfile` | `FormRegistry.get('profileForm')` (via `formCard` widget) | Schema-driven form appears pre-filled in the chat; submitting updates `ProfileService` and navigates to `/profile` |
| *"Show me the dashboard, then open my profile"* | `navigateTo` × 2 | `ActionRegistry` twice | Sequential navigation; agent calls the same tool twice in one turn (or two turns depending on the LLM) |

### `demo-server` `/agents/echo/run` (no LLM)

Useful smoke test before configuring an API key. Connect any host with
`provideAgUiBackend({ url: 'http://localhost:4111/agents/echo/run' })`.

| Prompt | What happens |
|---|---|
| *anything* | Echo agent streams `You said: <your message>` back word-by-word — proves the AG-UI SSE pipeline works end-to-end without burning API credits |

### `demo-ediscovery-shell` + remotes (port 4300)

Enterprise reference application. Host on `:4300` with three federated
remotes (review on `:4302`, production on `:4303`, search on `:4304`)
plus a multi-agent orchestrator on `/agents/coordinator/run`. Persona
switcher in the header drives `RegistryBase.setScopePolicy` — the
visible tool surface changes per role.

#### Phase 0–8 (collection + holds + production + search + audit + MCP + persona)

| Prompt | Routes to | Renders |
|---|---|---|
| *"Add Sarah Chen as a custodian, sarah.chen@acme.example, Engineering"* | collection | `custodianCard` |
| *"List all custodians on this matter"* | collection | up to 3 `custodianCard`s + summary text |
| *"Place a legal hold on Sarah Chen — scope: all emails about Project Phoenix from January 2025"* | collection | `legalHoldCard` |
| *"Show me pending hold acknowledgements"* | collection | filtered `legalHoldCard`s |
| *"Search documents tagged 'responsive' but not 'privileged'"* | search | result list with custodian + snippet |
| *"Tag DOC-7891240 as privileged — work-product"* | review | tag chip update |
| *"Create production set PROD-002 with the responsive non-privileged docs from January"* | production | `productionConfigForm` for sign-off |

#### F1–F6 dynamic-UI capabilities

| Prompt | Capability | What you see |
|---|---|---|
| *"Onboard a custodian from the Finance team"* | F1 composable form | `custodianIntakeCard` mounts with Identity + Compliance + Approval + Discovery sections; switching persona toggles supervisor section live |
| *"Onboard a custodian, type Eleanor for the supervisor"* | F2 live data | Supervisor picker autocomplete populates from the `users` data source (mock directory of 5 reviewers) |
| *"Open the place-legal-hold wizard"* | F3 workflow | `placeLegalHoldCard` mounts the four-step wizard (scope → custodians → date range → preview); zero custodians selected jumps to matter-setup |
| *"Release HOLD-001, it's redundant"* (as paralegal) | F4 approval | Tool intercepts; `mvk-approval-card` renders inline; switch persona to Lead Counsel via header to see Approve / Reject; `/approvals` page lists the same record |
| *"Run TAR classification on the un-tagged corpus for SEC inquiry"* | F5 LRO | `mvk-operation-progress` widget streams pct + phase; sidebar Operations badge ticks; `/operations` page lists active + recent |
| Drag a PDF onto the chat panel + *"Apply this rubric to the un-tagged set"* | F6 multi-modal | Pending-attachments tray shows the chip; Send delivers `{kind: 'file', filename, uri}` part to the agent |

**Persona switching tests** (header dropdown drives `setScopePolicy` + `AGENTIC_ACTIVE_PERSONA`):

| Persona | Tools visible (chat-rail count) | F4 approval visibility |
|---|---|---|
| Lead Counsel | all (~25) | sees every approval in `/approvals`, can sign off |
| Associate | most | sees `releaseLegalHold` approvals (co-approver) |
| Paralegal | collection + intake + workflow + LRO | requests trigger HITL on irreversible actions |
| Lit-Support | search + tagging | requests trigger HITL on `releaseLegalHold` |
| Vendor Reviewer | tag-only | requests trigger HITL on most mutating tools |

## Reference — by library feature

### `ToolRegistry` + `ComponentRegistry` (generative UI)

The base case: agent calls a tool, tool returns `{components: [{name, props}]}`,
host renders the named widget.

| Demo | Prompt |
|---|---|
| `demo-monolith` | *"Book a flight from LAX to JFK on 2026-05-05"* |
| `demo-multi-agent` | Any of the three domain prompts |
| `demo-shell` | Same — but the components were shipped by an MFE remote |

### `BackendRegistry` (multiple backends)

| Demo | Manual switch |
|---|---|
| any | Edit `environment.agentUrl` to swap between `/agents/gemini/run`, `/agents/echo/run`, `/agents/orchestrator/run` |

The `swap-backend.md` cookbook walks through wiring a runtime backend-switcher UI; no demo currently ships one (good first PR).

### `MfeRegistryClient` + `CapabilityRegistry` (federation)

| Demo | Action | Expected |
|---|---|---|
| `demo-shell` | Open the host with all remotes running | Header reads `Capabilities: 5 tool(s) across 3 remote(s): demo-remote-support, demo-remote-loyalty, demo-remote-bookings` |
| `demo-shell` | DevTools → Network panel → filter `4201` while loading | `remoteEntry.json` and chunk fetches visible — federation runtime really did fetch from the bookings remote |
| `demo-shell` | DevTools → Sources → `webpack://` (or equivalent for esbuild) | The host's chat references `FlightCardComponent` from `examples/demo-remote-bookings/src/app/widgets/flight-card.component.ts` — same class identity rendered locally on `:4201` |

### `OrchestratorAgent` (multi-agent routing)

| Demo | Prompt | Expected |
|---|---|---|
| `demo-multi-agent` or `demo-shell` | *"Book LAX→JFK"* (fresh thread) | Italic "_Routed to **bookings** specialist._" banner once, then bookings responds |
| same | Add a tool result; runUntilSettled re-runs | Banner does NOT repeat (sticky-by-thread short-circuit) |
| same | *"Switch to loyalty: how many points do I have?"* | New banner "_Routed to **loyalty** specialist._" — domain switch detected |

To verify the **keyword fallback** path (if the LLM classifier hits quota):
in any of the multi-agent demos, hit `/agents/orchestrator/run` rapidly
20+ times within a minute on a free-tier Gemini key, then watch
`/tmp/demo-server.log` for `classifier fell back to keywords` lines.
Routing keeps working without an LLM call.

### `ActionRegistry`

| Demo | Prompt | Effect |
|---|---|---|
| `demo-feature-tour` | *"Take me to /profile"* | Router navigates |
| `demo-feature-tour` | *"Show a toast: hello world"* | Toast appears |

### `FormRegistry` + `<mvk-form-renderer>`

| Demo | Prompt | Effect |
|---|---|---|
| `demo-feature-tour` | *"Edit my profile"* (no pre-fill) | Form opens with current `ProfileService` values |
| `demo-feature-tour` | *"Edit my profile, set the email to alice@example.com"* | Form opens pre-filled with `email: alice@example.com` (extracted by the LLM from the prompt) |
| `demo-feature-tour` | Submit the form | `submit` callback runs → `ProfileService.update(values)` + toast + navigate to `/profile` |

### `DataSourceRegistry`

| Demo | Prompt | What's special |
|---|---|---|
| `demo-feature-tour` | *"Look up user U-1042"* | Tool calls `dataSources.get('users').adapter({path})` instead of inlining `fetch()` — same call works against the mock or a real REST endpoint just by changing the registration |
| `demo-feature-tour` | *"Look up users U-1001 and U-2002"* | Tests whether the LLM batches calls or splits — both are correct |

### `IntentRegistry` (illustrative)

The chat shell does NOT auto-consult `IntentRegistry`. To see the registered intent, in `demo-feature-tour`:

```ts
inject(IntentRegistry).list();
// → [{ id: 'goHomeIntent', examples: ['take me home', ...], ... }]
```

To use it pre-LLM, wrap the chat input with a check that calls
`IntentRegistry`'s lookup and short-circuits the LLM call when an
intent matches. The cookbook entry covers the pattern.

### `ValidationRegistry`

Built into every tool / widget registration that uses Zod (which is
all of them). Trigger an unhappy path:

| Prompt | Expected |
|---|---|
| Edit a tool's handler to return a bad `flightCard` shape (e.g., missing `bookingId`) and rebuild | `ComponentRegistry`'s validator rejects the props before the widget renders; an inline `__error__` message appears under the tool result |

### Telemetry (`AgenticTelemetrySink`)

| Demo | Setup | What you see |
|---|---|---|
| any with `telemetry: 'console'` (the dev default) | Open browser DevTools → Console | Each registry mutation, run start/finish, and tool invocation logs as a structured `{ts, level, msg, ...}` line |

## Adversarial / boundary prompts

For everyone running the demos manually:

| Category | Prompt | Expected |
|---|---|---|
| Out-of-domain | *"What is the capital of France?"* | Agent answers from base knowledge — no tool call |
| Tool not registered | *"Process my refund"* (no `refundTool`) | Agent explains it lacks the tool, suggests support ticket |
| Malformed args | *"Book a flight to nowhere"* | Zod validation fails before the handler runs; agent retries with corrected args (good LLM) or apologises (worse) |
| Abort mid-stream | Send a long-context prompt, then click Stop / hard-reload mid-response | Stream cuts cleanly; server-side AbortSignal fires; no zombie request in `/tmp/demo-server.log` |

## Where each prompt lives in the docs

| Cookbook page | Prompts it lists |
|---|---|
| [Quickstart](./quickstart.md) | None — points here |
| [Integrate into existing app](./integrate-into-existing-angular-app.md) | Phase-by-phase verification prompts |
| [Federate an MFE](./federate-an-mfe.md) | Federation flow — points here |
| [Multi-agent orchestration](./multi-agent-orchestration.md) | The routing-decision prompts |
| [Domain MFE standalone + federated](./domain-mfe-standalone-and-federated.md) | Form-driven UI prompts (no chat) |
| [Extended registries feature tour](./extended-registries-feature-tour.md) | Action / Form / DataSource prompts |
| [Swap the backend](./swap-backend.md) | Comparison prompts — points here |
| [Schematics reference](./schematics.md) | n/a |
| **This page** | Consolidated reference for everything |
