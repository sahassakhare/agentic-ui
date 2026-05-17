# Context-aware agent — test scenarios

How to verify, hands-on, that an agent's tool surface and rendered UI
adapt to **who is asking** (persona), **what the data is** (matter
type, department), and **what state the system is in** (live data),
without re-prompting and without remounting widgets.

This guide is a hands-on walkthrough you run against the
[`demo-ediscovery-shell`](../../examples/demo-ediscovery-shell/) flagship.
It pairs with the architecture summary in
[ADR-008 — Registry scope policy](../adr/0008-registry-scope-policy.md)
and the F1 details in [Composable intake form](./composable-intake-form.md).

## What "context-aware" means in this library

Three mechanisms compose to give the appearance of an agent that
"knows where you are":

1. **Persona-aware tool surface** — `RegistryBase.setScopePolicy(policy)`
   runs a filter on every `list()` / `get()` / `signal()` read across
   all 15 registries. The host installs a policy that reads
   `AGENTIC_ACTIVE_PERSONA` (an injection token) and matches each
   registry entry against the active persona's allow-list. Switching
   persona updates the signal; every consumer recomputes; the chat
   shell sends the agent a smaller `tools[]` array on the next turn.

2. **F1 predicate-gated composition** — registered forms declare
   sections with an `if:` string evaluated by the F1 closed-AST DSL
   (`===`, `!==`, `&&`, `||`, dotted access, parens, literals; own-
   property only — no `eval`). The form-renderer re-evaluates the
   predicates on every signal-driven render against a context object
   the host supplies (`{ matter: { type }, persona, department }`).

3. **F2 live data** — `DataSourceRegistry` adapters feed widgets
   server-authoritative state (e.g. a `users` directory backing a
   supervisor autocomplete) so the agent's responses ground in
   current data without inlining `fetch()` calls.

The combined behaviour: the agent's *capabilities* and the rendered
form's *shape* both change live as the user navigates.

## Prerequisites

Boot the eDiscovery flagship's five services per the
[quickstart](./quickstart.md) — minimum:

```bash
cd examples/demo-ediscovery-server && npx tsx src/server.ts   # :4311 (needs Gemini key)
npx ng serve demo-ediscovery-shell      --port 4300
npx ng serve demo-ediscovery-review     --port 4302
npx ng serve demo-ediscovery-production --port 4303
npx ng serve demo-ediscovery-search     --port 4304
```

Wait until `:4311/health` reports `coordinator: gemini-orchestrator`
and the four ng-serve sites all return 200. Open
[http://localhost:4300](http://localhost:4300).

## Test 1 — Persona-aware tool surface (`setScopePolicy`)

The chat-rail capability counter and the agent's available `tools[]`
both shrink to match the active persona's allow-list.

| Step | Action | Expected |
|---|---|---|
| 1 | Open the shell. Top header has a **Lead Counsel** dropdown — the persona switcher. | — |
| 2 | Read the chat rail's capability counter (top-right, `⚡ N`). | `⚡ 21` (Lead Counsel sees all 21 tools). |
| 3 | Click the dropdown → switch to **Paralegal**. | Counter drops to ~13 — collection / intake / workflow / LRO surface only. |
| 4 | Switch to **Vendor Reviewer**. | Counter drops further to tag-only tools. |
| 5 | Open `/approvals` (sidebar). | Different rows per persona — Lead Counsel sees every approval; Paralegal sees only those they're a co-approver on. |

**Cross-persona sanity check.** Same prompt fires different paths:

- As **Paralegal**: type *"Release HOLD-001"*. The F4 intercept fires and an approval card appears (paralegal can't auto-execute).
- As **Lead Counsel**: same prompt. Tool runs immediately, no intercept.

**Wire-level proof.** Open DevTools → Network → filter on `/agents/coordinator/run`. Switch persona, fire any prompt; the request body's `tools[]` array length matches the rail counter. `setScopePolicy` is filtering at the read site, not just in the UI.

## Test 2 — F1 predicate-gated composition (reactive)

The custodian intake form has 4 sections, each gated by an `if:`
predicate. Switching persona while the form is mounted re-evaluates
the predicates **without** remounting or re-prompting.

| Step | Action | Expected |
|---|---|---|
| 1 | Switch persona to **Paralegal** via the header. | — |
| 2 | Open the chat rail's "Try asking" panel; click the **F1** prompt: *"Open the custodian intake form for a Finance team member"*. | Agent routes to collection specialist; `app-custodian-intake-card` mounts. |
| 3 | Verify all four sections present. | **Identity** (always) · **Compliance** (Reg-FD §2.4 — fires on `matter.type === "securities"`) · **Approval — Supervisor sign-off** (fires on `persona !== "lead-counsel"`) · **Discovery — accounting systems** (fires on `department === "Finance"`). |
| 4 | **Without closing the form**, switch persona to **Lead Counsel**. | Approval / supervisor section **vanishes in place** — no widget remount, no agent round-trip. The header subtitle updates to `securities · lead-counsel`. |
| 5 | Switch back to **Paralegal**. | Supervisor section reappears. Header subtitle: `securities · paralegal`. |

**What's happening.** The widget injects `PersonaService` and reads
`personaService.active` (a live signal). The form's `context()` is a
`computed()` derived from that signal. Every render re-runs the F1
predicate evaluator against the fresh context, returning a possibly-
different visible section list. Angular's signal-aware change
detection drops / mounts only the changed section.

**Why this is non-trivial.** A naive implementation reads persona from
the agent's tool-result props, which freezes the value at tool-call
time. The persona dropdown then updates a global signal that nothing
in the form is subscribed to, so the form keeps showing the original
sections forever — even though `setScopePolicy` is reactive elsewhere.
The fix is in [`custodian-intake-card.component.ts`](../../examples/demo-ediscovery-shell/src/app/agentic/custodian-intake-card.component.ts):
read persona from the live `PersonaService` signal, not from the
agent's frozen prop.

## Test 3 — F2 live data (DataSourceRegistry)

The Approval section (visible when persona ≠ lead-counsel) holds a
**Supervisor** picker fed by the `users` data source — a mock directory
of 5 reviewers in this demo, swappable for a real REST endpoint via
adapter swap.

| Step | Action | Expected |
|---|---|---|
| 1 | With the intake form open as **Paralegal** (Approval section visible). | — |
| 2 | Click the Supervisor picker; type **`El`**. | Autocomplete returns **Eleanor** from the directory. |
| 3 | Pick Eleanor. | Form value updates; submit would route the approval to her. |

Driven via prompt: *"Onboard a custodian, type Eleanor for the supervisor"* (the F2 prompt in the rail).

## Test 4 — `/approvals` queue cross-persona

The same approval record renders as **three different views** depending
on who's looking — pure `setScopePolicy` filtering on the same data.

| Step | Action | Expected |
|---|---|---|
| 1 | As **Paralegal**, type: *"Release HOLD-001, it's redundant"*. | The F4 intercept creates an approval record. |
| 2 | Open `/approvals` (sidebar). | One pending row visible. |
| 3 | Switch to **Lead Counsel**. | Same row gains **Approve / Reject** buttons (lead-counsel is in the approver allow-list). |
| 4 | Switch to **Vendor Reviewer**. | Row disappears entirely (out of scope). |

Same record, three views, scoped purely by `setScopePolicy`. No data
duplication, no per-role queries.

## Test 5 — verify persona signals via DevTools

For "show me this is real, not just CSS hiding":

1. Open DevTools → Network → filter on `/agents/coordinator/run`.
2. Switch persona via the header.
3. Fire any prompt.
4. Inspect the request body. The `tools[]` array length matches the rail counter for that persona.
5. The `messages[]` array is identical across personas (chat history is the same); only the tool list changes.

The agent literally never sees out-of-scope tools — the filter runs in
the browser before the request goes out.

## Headless reproduction

The Playwright spec at [`e2e/05-persona-scope.spec.ts`](../../e2e/05-persona-scope.spec.ts)
codifies Tests 1 and 4. Run:

```bash
npm run test:e2e -- --grep="05-persona-scope"
```

Test 2's reactive-section behaviour is asserted ad-hoc by the
[`Test 2` script in the chat-rail README](#) — paste it into a Node
file with Playwright installed, run against a live shell, expect:

```
[PARALEGAL]               identity=true compliance=true supervisor=true  discovery=true
[LEAD COUNSEL (no remount)] identity=true compliance=true supervisor=false discovery=true
[PARALEGAL (back)]        identity=true compliance=true supervisor=true  discovery=true

✅ TEST 2 PASS — supervisor section flips on persona switch (no remount)
```

## Common pitfalls (and the bugs we hit during validation)

These are real bugs we found and fixed while making this guide work
end-to-end. Keep them in mind when adding new context-aware behaviour.

### Pitfall 1 — Persona captured as a frozen prop

**Symptom.** Form sections that should flip on persona switch don't,
even though `setScopePolicy` correctly filters tools.

**Cause.** The widget reads persona from a static `input()` populated
at tool-call time:

```ts
// ❌ frozen at tool-call time
readonly persona = input.required<string>();
ctx = computed(() => ({ persona: this.persona() }));
```

**Fix.** Read persona from the live `PersonaService` signal:

```ts
// ✅ reactive
private readonly personaService = inject(PersonaService);
ctx = computed(() => ({ persona: this.personaService.active() }));
```

### Pitfall 2 — Allow-list missing for the persona that triggers the predicate

**Symptom.** F1 supervisor section appears in NO persona, because the
only persona that's *supposed* to see it (paralegal / associate / lit-
support) doesn't have the tool that opens the form in their allow-list,
so they can never reach the form. Lead Counsel can open the form but
their persona makes the predicate `false`.

**Cause.** Allow-list authored without thinking about which personas
trigger which predicates:

```ts
// ❌ paralegal has no openCustodianIntake → predicate unreachable
{ id: 'paralegal', allowedTools: ['searchDocuments', 'tagDocument', ...] }
```

**Fix.** Grant intake access to the personas the form is *meant for*:

```ts
// ✅
{ id: 'paralegal', allowedTools: [..., 'openCustodianIntake', 'generateCustodianIntakeForm'] }
```

### Pitfall 3 — Ambiguous prompt makes the LLM pick the wrong tool

**Symptom.** *"Onboard a custodian from the Finance team"* sometimes
calls `listCustodians` (interpreting "from Finance team" as a search
filter) instead of `openCustodianIntake`.

**Cause.** Tool descriptions overlap; LLM disambiguates wrong.

**Fix.** Tighten the prompt or the tool description, *not* the
allow-list:

```
"Open the custodian intake form for a Finance team member"   ← unambiguous
```

## Where this lives in the code

| Concern | File |
|---|---|
| Scope policy installation | [`examples/demo-ediscovery-shell/src/app/app.config.ts`](../../examples/demo-ediscovery-shell/src/app/app.config.ts) |
| Per-persona allow-lists | [`examples/demo-ediscovery-shell/src/app/services/persona.service.ts`](../../examples/demo-ediscovery-shell/src/app/services/persona.service.ts) |
| F1 predicate evaluator (closed-AST DSL) | [`projects/agentic-ui/src/lib/forms/`](../../projects/agentic-ui/src/lib/forms/) |
| Reactive intake card | [`examples/demo-ediscovery-shell/src/app/agentic/custodian-intake-card.component.ts`](../../examples/demo-ediscovery-shell/src/app/agentic/custodian-intake-card.component.ts) |
| F2 supervisor data source | [`examples/demo-ediscovery-shell/src/app/agentic/agentic.ts`](../../examples/demo-ediscovery-shell/src/app/agentic/agentic.ts) (`registerDataSources`) |
| Cross-persona approval queue | [`examples/demo-ediscovery-shell/src/app/pages/approvals.component.ts`](../../examples/demo-ediscovery-shell/src/app/pages/approvals.component.ts) |
| `RegistryBase.setScopePolicy` (filter-on-read) | [`projects/agentic-ui/src/lib/registries/registry-base.ts`](../../projects/agentic-ui/src/lib/registries/registry-base.ts) |

## Related

- [ADR-008 — Registry scope policy](../adr/0008-registry-scope-policy.md) — design rationale for filter-on-read
- [Composable intake form (F1)](./composable-intake-form.md) — predefined-catalog form composition
- [Approval flow (F4)](./approval-flow.md) — HITL approval queue and persona-gated sign-off
- [Sample prompts](./sample-prompts.md) — eDiscovery prompts, including the F1–F6 capability prompts surfaced in the chat-rail "Try asking" panel
