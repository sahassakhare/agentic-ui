# eDiscovery — trimodal surfaces, validation, routing, headless LLM, complex workflow

**Status:** in progress · **Owner:** sahas · **Started:** 2026-05-11

This plan consolidates the five eDiscovery example asks captured in the
2026-05-10/11 design conversations into one execution document. The
shape is: prove that **the same registry definitions** (forms,
workflows, tools) work across **three trigger surfaces** (chat, direct
page mount, headless LLM), with **first-class validation UX**, **route
deep-linking**, and **complex multi-actor workflows** including
human-in-the-loop and long-running steps.

The intent is demo-grade rigor: every requirement gets a pageable,
clickable surface in the eDiscovery shell + a cookbook entry adopters
can copy-paste, NOT just talking points.

---

## Non-goals

- Net-new agent protocols. Use the AG-UI / Hashbrown / A2UI adapters
  already shipped.
- Net-new registries. The 15 existing registries are sufficient.
- Lib-level breaking changes. Every lib change is additive + opt-in.
- Production hardening of the eDiscovery server. Demo data + demo auth
  remain as-is; this plan is about the UI tier.

---

## Hard constraint — additive only

Existing tools, forms, workflows, MFEs, audit pipelines, and tests
**must continue to work unchanged**. Every new feature is opt-in:
new optional fields default to current behavior; new pages live at
new routes; new components are new selectors. No registry shape
edits. No removal of existing tool/form/workflow. CI must stay green
at every commit boundary.

---

## Requirement R1 — Render-target routing

**The problem.** Today every tool result renders inline in the chat
panel on whatever route the user is on. Operators expect: *if the
agent produces a legal-hold draft, take me to `/holds`; if it
produces a production card, take me to `/productions`*. Deep-link
behavior should be a property of the tool/widget contract, not a
chat-shell hardcode.

**Lib change (additive).** Add an optional `renderTarget` field on
`ToolResult`:

```ts
type ToolResult = {
  components?: ComponentSpec[];
  markdown?: string;
  renderTarget?:
    | { kind: 'inline' }                                                          // current default
    | { kind: 'route'; path: string; queryParams?: Record<string, string>;
        mode?: 'navigate-and-mount' | 'navigate-only' }                           // route deep-link + slot
    | { kind: 'slot'; slot: string };                                             // mount in a named slot on current page
};
```

Default omitted = `inline`. Existing tools that omit it keep current
behavior. Every existing chat-shell test stays green.

**Host change (eDiscovery shell).** New `RenderHandoffStore`
(root-scoped) keyed by slot name. New `<mvk-agentic-slot
name="…">` component on destination pages reads the store and
mounts components via `<mvk-widget-container>`. After mount, the
slot clears so a refresh doesn't re-mount.

**Tools to wire (3, the rest stay inline):**

| Tool | Target |
|---|---|
| `placeLegalHoldTool` | `route /holds`, slot `holds.primary` |
| `openCustodianIntake` | `route /custodians`, slot `custodians.primary` |
| `previewProductionTool` | `route /productions`, slot `productions.primary` |

**Demo path.** Type *"place a legal hold for Project Phoenix"* in
chat from `/`. Shell navigates to `/holds`, mounts the legal-hold
card via the slot, chat panel shows a small "Opened in /holds —
view there ↗" link. No double-mount.

**Trade-offs.**
- Deep-link routing reframes the chat shell as an intent producer;
  it stops being the only mount surface. That's the goal.
- Could collapse `renderTarget` into the existing `agenticAction`
  navigation actions. Keep separate: action = intent (`openHold`),
  renderTarget = mount destination. Distinct concerns.

---

## Requirement R2 — Form-control validations demo

**The problem.** Forms validate at submit-time, but the demo never
shows operator-visible validation UX (touched-state errors, async
checks, conditional required). Adopters reading the demo can't see
the canonical pattern.

**Single canonical form for the showcase: `custodianIntakeForm`**
(already exists). Promote it to demonstrate the full range:

| Field | Validator | Demonstrates |
|---|---|---|
| `name` | `z.string().min(2).max(80)` | length, required-touch |
| `email` | `z.string().email()` + async DNS check | format + async |
| `department` | `z.enum([…known])` with "other" fallback | conditional reveal |
| `supervisor` | `z.string().min(1)` + cross-check against `MatterStore` | registry-backed |
| `regulatoryAck` | `z.boolean().refine(v => v === true)` when `matter.type==='securities'` | cross-field rule |
| `accountingSystems` | `z.array(z.string()).min(1)` when `department==='Finance'` | conditional required |

**UX surface (CSS + template only — no lib changes).**
- Red border + `aria-invalid="true"` on touched-and-invalid fields.
- Inline `<small class="error">` per control with the exact Zod
  message.
- Submit disabled while form invalid; tooltip names the first
  blocker.
- Server-side echo: 422 errors map `errors[].path` → field error.

**Demo path.**
- *Chat:* "onboard a Finance custodian" → fires `openCustodianIntake`
  with `department=Finance` → all four conditional rules become
  active. User intentionally enters bad email → red border + inline
  error. User checks regulatory ack → submit enables.
- *Direct page:* (see R4) — same form, same validation, no chat.

**Trade-off.** We could push validation into the lib's form
renderer as a generic "show errors when touched" affordance.
Defer — the demo proves the pattern; lib generalization is a
separate ADR after we see two more adopters.

---

## Requirement R3 — Trimodal surfaces (forms + workflows alongside chat)

**The thesis.** A registry definition (form / workflow) is
*surface-independent*. The same `custodianIntakeForm` should mount
identically when triggered by:

1. **Chat** — LLM tool-call → existing `<mvk-widget-container>`.
2. **Direct page** — user clicks a link or hits a route, no LLM.
3. **Headless LLM** (R4) — Cmd+K → LLM picks definition → mounts
   via R1 slot.

**Already in place.** `<mvk-form-renderer name="…">` and
`<mvk-workflow-renderer name="…">` are both standalone components
that resolve definitions from the registry. The lib already
supports this; the demo doesn't show it.

**Pages to add:**

| Route | Renders | Trigger |
|---|---|---|
| `/intake/custodian` | `<mvk-form-renderer name="custodianIntakeForm">` | direct |
| `/workflows/place-hold` | `<mvk-workflow-renderer name="placeLegalHold">` | direct |

Both pages reuse the same `MatterStore`, same `ActionRegistry`, same
audit chain. Submit on `/intake/custodian` adds a custodian
identical to the chat-triggered path; activity feed proves it.

**Dashboard "trimodal launcher" panel.** Replace placeholder cards
on `matter-dashboard.component.ts` with a 3×3 grid:

```
                    │ Chat                │ Direct page          │ Cmd+K (LLM)
────────────────────┼─────────────────────┼──────────────────────┼─────────────
 Custodian intake   │ "onboard a Finance   │ → /intake/custodian │ "add finance
                    │   custodian"         │                      │   person…"
 Place legal hold   │ "place a legal hold" │ → /workflows/place-  │ "hold cust X
                    │                      │   hold               │   for matter Y"
 Production preview │ "preview production" │ → /productions       │ "show next
                    │                      │                      │   batch"
```

Each cell links/types the trigger; the result is identical.

**Trade-off.** Showing every cell of the matrix on the dashboard is
demo-noisy. It's the entire point of the demo — keep it.

---

## Requirement R4 — Headless LLM (no-chat, but LLM-mediated)

**The problem.** Adopters need agentic UI without committing the
whole UX to a chat-shell. They want command-palette / smart-button /
inline-NL patterns with the same registries.

**Helper: `runHeadless()`.** Single new function in the eDiscovery
shell, no lib change:

```ts
async function runHeadless(opts: {
  prompt: string;
  context?: Record<string, unknown>;
  toolFilter?: (t: ToolDef) => boolean;
  expect?: 'widget' | 'args';
}): Promise<{ components?: ComponentSpec[]; args?: unknown }>
```

System prompt is shorter and stricter than the chat prompt:
- `expect: 'widget'` → *"You are an action-router. Pick exactly one
  tool. Do not converse."*
- `expect: 'args'` → *"You are a parameter extractor. Return JSON
  matching schema X."*

**Three surfaces:**

**(A) Command palette (Cmd+K).** New
`<mvk-command-palette>` component overlay. Cmd+K from any page
opens a single-line input. Submit → `runHeadless({ expect:
'widget' })` → result mounts via R1's slot. Modal closes.

**(B) Smart button on the dashboard.** A button:
*"Suggest custodians for this matter"*. Click sends a templated
hidden prompt (`"Given matter ${matter.summary}, propose 3-5
custodians with department + role"`) → LLM emits a
`proposeCustodians` widget → user reviews & accepts.

**(C) Inline NL textarea on `/documents`.** *"Describe what you're
looking for"* → `runHeadless({ expect: 'args' })` → returns
structured `searchFilters` → page applies them. No widget mount.

**Cost discipline.**
- `keywordToolFilter({ maxTools: 12 })` so prompts stay small.
- Cap user input at 200 chars.
- Cache deterministic prompts (smart-button templates) for 60s.
- Failure UX: *"I couldn't match that to an action — try wording
  it differently or use the menu."*

**Trade-off.** Surface (A) is a developer-favorite but every Cmd+K
is an LLM call. Cap the tool list and document the cost.

---

## Requirement R5 — Complex workflow

**The problem.** The existing `placeLegalHold` workflow is
single-actor, all-synchronous, all-in-memory. Real legal workflows
have multiple actors, long-running steps, mid-flow approvals, and
must survive page refresh.

**Demo: "Place legal hold + collect" — 6-step workflow**

| # | Step | Type | Persona gate | Notes |
|---|---|---|---|---|
| 1 | `matter-setup` | form | `lead-counsel` | matter id, scope, custodian filter |
| 2 | `custodians` | form (multi-select) | `lead-counsel` | conditional next: 0 selected → step 1 |
| 3 | `notice-draft` | LLM-generated widget | `lead-counsel` | agent drafts the hold notice; user edits |
| 4 | `approval` | F4 `agenticApproval` | `senior-counsel` | **PAUSES** — workflow suspends, persists state |
| 5 | `send-and-collect` | longRunning operation | `lead-counsel` | ~30s simulated; live progress card |
| 6 | `preview` | read-only summary | any | terminal step; submit triggers `onComplete` |

**Lib pieces in use (all already shipped):**
- `agenticWorkflow({ steps, onComplete })` — orchestration
- `agenticApproval({...})` (F4) — for step 4
- `agenticTool({ longRunning: true })` (F5) — for step 5
- `RegistryBase.setScopePolicy(predicate)` — for persona gates
- `OperationRegistry` — long-running progress

**New work (eDiscovery shell only):**
- Step-level `requiresPersona` predicate. Step-renderer greys out
  steps when `AGENTIC_ACTIVE_PERSONA` doesn't match; an
  out-of-scope reviewer sees a "waiting on senior-counsel" panel.
- `WorkflowStateStore` persistence — serialize step state to
  `localStorage` keyed by `workflowId`; resume on page reload.
  Production deployments swap to `PersistenceRegistry` adapter.
- Page route `/workflows/place-hold-and-collect` mounts the new
  workflow def. Visible from the dashboard and the chat path.

**Out of scope (called out as future RFC):**
- Branch-and-rejoin (DAG workflows). Tree-only stays.
- Distributed compensating actions (true SAGA). Document the
  host-side pattern in the cookbook; keep the demo's `onComplete`
  as the txn boundary.

**Trade-off.** localStorage persistence is demo-grade. Real
adopters MUST swap to `PersistenceRegistry` because localStorage is
per-browser and unreviewed. Document that explicitly.

---

## Implementation order

Each phase is a standalone commit that keeps CI green. Phases 1+2
are pure-additive (no lib changes); phase 3 introduces the optional
lib field.

| # | Phase | Files (approx) | Risk |
|---|---|---|---|
| 1 | **Trimodal pages + dashboard launcher** (R3) | 2 new pages + dashboard edit + 2 specs | low — pure addition |
| 2 | **Validation demo on `custodianIntakeForm`** (R2) | edits to intake-sections.component.ts + sub-widgets + spec | low — visual edits |
| 3 | **`renderTarget` lib field + slot + R1 routing on 3 tools** | lib type addition (1 file) + new `RenderHandoffStore` + `<mvk-agentic-slot>` + slot adoption on 3 pages + tool wiring | medium — lib touch but optional field |
| 4 | **`runHeadless()` + Cmd+K palette + smart button + NL search** (R4) | new helper + new palette component + dashboard button + search NL input | medium — depends on phase 3 slot |
| 5 | **Complex workflow (R5) — `placeLegalHoldAndCollect`** | new workflow def + persona-gated step renderer + WorkflowStateStore localStorage adapter + new page + integration test | medium — exercises F4 + F5 + persona scope together |

After every phase: `npm test` for catalog + `ng test agentic-ops-console` + `ng test demo-ediscovery-shell` (if a spec target exists). No phase ships without green tests.

---

## Test discipline

- Each new page has a vitest spec asserting it mounts the registered
  definition (`<mvk-form-renderer>` resolves to the right form;
  submit dispatches into the same store).
- Validation demo has a spec covering every cross-field/conditional
  rule (run the form with bad inputs, assert error surfacing).
- Headless `runHeadless` is testable via the same backend stub the
  chat shell tests use. The palette spec asserts modal open/close
  behavior; LLM behavior is integration-tested manually.
- Workflow spec asserts pause-resume across a simulated reload
  (write `localStorage`, recreate component, assert step is
  restored).

CI policy: every commit on this branch must keep the existing 207
catalog tests + 88 ops-console tests green. New tests are additive.

---

## Documentation

| Doc | Why | Phase |
|---|---|---|
| `docs/cookbook/forms-workflows-as-surfaces.md` | the trimodal contract is the headline learning | after phase 1 |
| `docs/cookbook/agentic-without-chat.md` | command palette + smart buttons + inline NL | after phase 4 |
| `docs/cookbook/complex-workflow.md` | HITL + longRunning + persona gates pattern | after phase 5 |
| Update `README.md` use-case row #11 (composable forms) | mention direct-page mount option | after phase 1 |
| New ADR for `renderTarget` lib field | small ADR documenting the additive contract | after phase 3 |

---

## Open architectural questions

1. **Single mount vs dual mount when chat + route both visible.**
   When `renderTarget.kind === 'route'` and chat is on `/`, the
   chat panel will show the markdown response. Should it ALSO
   render a stub component in the panel? Decision: **no** — the
   chat panel shows a clickable "Opened in /holds — view there ↗"
   link, the actual mount is in the route page only. Avoids dual
   audit entries and weird state divergence.

2. **Slot vs prop input plumbing.** Chat passes tool-result
   `props` directly to `<mvk-widget-container>`. Direct mount
   accepts `[context]` input on `<mvk-form-renderer>`. Treat
   `context` as the input the form's `if` predicates evaluate
   against; the chat path packages tool args into context.
   Single evaluation surface. **Decided.**

3. **Persona scope in headless LLM.** `runHeadless` should respect
   the active persona's tool scope. Confirmed: `toolFilter` defaults
   to filtering by the current `AGENTIC_ACTIVE_PERSONA` predicate.
   Adopters can override but the secure default holds.

4. **What happens when LLM in surface (A) returns no tool call.**
   Show a soft message; don't dismiss silently. Decided.

---

## Definition of done

- [ ] All 5 phases shipped, each on green CI.
- [ ] Dashboard shows the 3×3 trimodal launcher, every cell works.
- [ ] `custodianIntakeForm` shows visible validation errors on
      touched-and-invalid; submit blocks until clean.
- [ ] `placeLegalHoldTool` from chat lands the user on `/holds`
      with the legal-hold card mounted there, not in the chat
      panel.
- [ ] Cmd+K opens a palette anywhere in the shell; typed text
      routes through the LLM and mounts the right widget.
- [ ] `placeLegalHoldAndCollect` workflow runs end-to-end with one
      pause-and-resume mid-flow (HITL approval), one ~30s
      long-running step, one persona handoff, surviving a browser
      refresh during step 4.
- [ ] All cookbook docs published.
- [ ] No regressions in existing tests; total catalog + ops-console
      test count strictly grows.
