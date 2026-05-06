# Plan: dynamic UI composition + ambient + governed agentic interaction

> **Status**: Draft for review (revision 2 — gaps from review folded in). No implementation yet.
>
> **Revision history**:
> - **r1** — original four features: composable form, live data fetch, interactive workflow, chat-less context agent.
> - **r2** *(this version)* — added four enterprise-buyer asks surfaced during validation: human-in-the-loop approval, long-running operations, multi-modal input, replay + undo.
>
> **Adds to**: the eDiscovery flagship at `examples/demo-ediscovery-{shell,server,review,production,search}`. Builds on the eight phases described in [`ediscovery-app-plan.md`](./ediscovery-app-plan.md).
>
> **Why this plan**: the current eDiscovery demo proves the basics — chat shell drives federated tools, tools render registered widgets. What it does not yet prove is the next class of agentic-UI capabilities that real enterprise apps need. Eight features in total, sequenced so each one builds on the prior:
>
> | # | Feature | Industry maturity | Buyers ask for it as |
> |---|---|---|---|
> | 1 | **Forms composed at runtime** from widget building blocks | Mature (JSON Schema Forms) | "AI fills out the form for me" |
> | 2 | **Live data fetching from dynamic widgets** via DataSourceRegistry | Mature (autocompletes, cascading dropdowns) | Table-stakes; not asked for explicitly |
> | 3 | **Interactive multi-step workflows** the agent guides | Mature (wizards); AI-guidance angle is emerging | "Walk junior staff through a complex process" |
> | 4 | **Human-in-the-loop approval** — agent drafts, human reviews + signs off | Mature (PR-style review, ServiceNow approvals) | "Junior does it, senior approves before it's live" |
> | 5 | **Long-running operations** with progress + checkpoint | Mature (Google `operations`, AWS Step Functions) | "What if the task takes 20 minutes?" |
> | 6 | **Multi-modal input** — voice / image / file upload as agent context | Increasingly table-stakes (M365, Claude, ChatGPT) | "Can users upload a screenshot or talk to it?" |
> | 7 | **Chat-less, context-driven interaction** — ambient agent reads UI state | Emerging (GitHub Copilot, Cursor, Notion AI, Einstein NBA) | "AI should know what I'm working on without me asking" |
> | 8 | **Replay + undo** of agent actions | Mature in audit-grade systems | "If the agent does the wrong thing, can I undo it?" |
>
> Library extensions are minimal additions to existing seams (`FormRegistry`, `ComponentRegistry`, `DataSourceRegistry`, `ActionRegistry`, `PersistenceRegistry`) plus three new abstractions: `WorkflowRegistry` (feature 3), `AgentContextStream` (feature 7), and `OperationRegistry` (feature 5). Audit / approval / undo all build on the existing tamper-evident chain from Phase 5 of the original eDiscovery plan.

## Goals and non-goals

**Goals**
- Demonstrate eight new agentic-UI patterns in the eDiscovery flagship using the same library + protocols (AG-UI), no protocol changes.
- Each pattern lives behind a small, testable library extension. No fork, no breaking changes.
- Each feature has at least one end-to-end Playwright spec asserting the visual outcome.
- Each pattern documented in `docs/cookbook/` with a code-level walkthrough.
- Cumulative: by the end, the eDiscovery flagship demonstrates the **full agentic-UI repertoire** an enterprise buyer would inspect — form generation, live APIs, guided workflows, governed approval, long ops, multi-modal, ambient suggestions, replay/undo.

### Definition of "shipped" per feature

Each of the eight features only counts as shipped once **all** of the following land in one (or a tight set of) commits:

| Deliverable | Why |
|---|---|
| Library code (`projects/agentic-ui/...`) + unit tests | The actual capability |
| Conformance test in `/testing` | Catches drift across backend adapters |
| eDiscovery demo wiring (`examples/demo-ediscovery-...`) | The pattern in real use |
| Playwright E2E spec (`e2e/specs/...`) | Catches regression on the visible flow |
| Cookbook entry (`docs/cookbook/...`) | Code-level walkthrough for adopters |
| **README "Use cases" matrix update** | The matrix's row count grows from 10 → 18; each new row links to the cookbook |
| **README "Problem statement" update** *(when applicable)* | Two of the new features address pain points worth surfacing in the architect-view table (approval = governance, undo = recoverability) |
| **Deck slide(s)** — at least one spotlight per feature | Mirrors the existing 5b · USE CASES section; same `_hero_image_slide` template, captures from the live eDiscovery deploy |
| **Hero animation refresh** *(when the GIF flow changes)* | If a feature changes the chat panel meaningfully (e.g. approval gate appears, LRO progress bar streams), regenerate `agentic-ui-in-action.gif` so the README's animated hero reflects current behaviour |
| **Deck regenerate + zip refresh** | `agentic-ui-overview.pptx` and `docs/distributions/agentic-ui-codebase.zip` updated in the same commit set |

This Definition of Done is intentionally heavy: the README + deck are how prospects evaluate the library. Falling behind on docs is the most common drift in an active codebase; making them part of "shipped" prevents that.

**Non-goals**
- Not a full forms framework. Composability is bounded by what `FormRegistry` already supports plus simple sequencing.
- Not a workflow engine. The "interactive workflow" feature is a multi-step flow with explicit transitions — it does not aim to replace BPMN-style orchestration.
- Not an arbitrary observability layer. The chat-less context stream is scoped to UI context (route + selected entity + persona) — not telemetry, not analytics.
- Not an event-sourced rebuild. Replay + undo (feature 8) records inverse operations alongside the audit chain; no global event bus required.
- No new agent protocol. AG-UI handles all eight cases via existing event types (`tool-call-*`, `widget-render`, `ui-action`).

## Feature 1 — Composable intake form (widgets → form)

### Scenario

The user clicks "Onboard custodian" in the eDiscovery shell. The agent recognises the matter type (securities litigation) and the persona (paralegal) and **picks** the right composition of fields to show:

- Always: name, email, department
- Because the matter is securities-related: **regulatory-disclosure consent** (a checkbox widget with a long disclaimer)
- Because the persona is paralegal (not lead-counsel): **supervisor signoff** (an email autocomplete that picks a senior reviewer)
- Because the custodian's department defaults to "Finance" (heuristic): **accounting-system selector** (a multi-select)

A different combination would show for a different matter / persona / department. The form is **composed at runtime** by the agent — not hard-coded as `CustodianIntakeFormComponent`.

### Library piece — extend `FormRegistry` with composition

Today: `agenticForm({ name, fieldsSchema, ui, submit })` registers a single, monolithic form definition. The renderer mounts one component for the whole form.

Add: a `composition` mode where a form is described as an **ordered list of registered widget names** plus a shared `submit` handler. Each widget becomes a section of the form; the renderer stacks them inside one `<form>` and aggregates their values.

```ts
agenticForm({
  name: 'custodianIntake',
  composition: [
    { widget: 'contact-card-fields',         section: 'Identity' },
    { widget: 'regulatory-consent-checkbox', section: 'Compliance', if: 'matter.type === "securities"' },
    { widget: 'supervisor-signoff-picker',   section: 'Approval',   if: 'persona !== "lead-counsel"' },
    { widget: 'accounting-system-picker',    section: 'Discovery',  if: 'department === "Finance"' },
  ],
  submit: async (values, ctx) => { /* aggregated values from all widgets */ },
});
```

- Each composition entry references a widget already in `ComponentRegistry`.
- `if` is a tiny expression DSL evaluated against the form context (`{ matter, persona, ...partialValues }`).
- The renderer subscribes to context signals — when persona switches, the form re-evaluates `if` clauses and adds/removes sections without losing values from sections that stayed.

### How the agent picks the composition

The agent doesn't author the composition object directly — that's hard-coded by the developer. Instead, the agent picks **which named composition to render** by calling a tool:

```
user: Onboard a custodian
agent: tool-call · openComposition({ name: 'custodianIntake' })
shell: <maverick-form-renderer composition="custodianIntake" />
```

Future variant: the agent emits a `widget-render` event with a synthetic composition assembled from widget names — useful when no pre-defined composition fits. Out of scope for v1; documented as future work.

### What's new in the library

| | |
|---|---|
| `FormDef.composition` | New optional field: `Array<{ widget: string; section?: string; if?: string }>` |
| `<maverick-form-renderer>` | Loops over composition, mounts each widget in a slot, aggregates values via a single `FormGroup` |
| Tiny expression evaluator | `if` clause parser — supports `===`, `!==`, `&&`, `||`, dotted property access. ~80 LOC. Conformance-tested. |

### Effort estimate
**Medium.** ~1.5 weeks. The bulk is the renderer + expression evaluator; the schema extension and demo wiring are straightforward.

## Feature 2 — APIs called from dynamically generated UI

### Scenario

The composed intake form (above) has fields that need backend lookups:
- **Department** is an autocomplete that fetches from `/api/departments?prefix=...`
- **Supervisor signoff** is an email picker that searches a directory: `/api/users?role=lead-counsel&matterId=...`
- **Accounting-system picker** lists which systems exist for the active matter — depends on the matter's `org_id`

Each widget needs to know **which DataSource to call**. The widget definition references it by name; the runtime injects the DataSource's adapter.

### Library piece — `DataSourceRegistry` is already there

The eDiscovery demo already uses `DataSourceRegistry` for `documentIndex` (search remote). This feature exercises it for **per-field data fetching** in dynamically rendered widgets.

A widget definition gains an optional `dataSources: string[]` field — the registry names the widget consumes. At mount time, the widget gets a typed accessor for each:

```ts
agenticWidget({
  name: 'supervisor-signoff-picker',
  component: SupervisorPickerComponent,
  propsSchema: z.object({ matterId: z.string() }),
  dataSources: ['users'],   // names from DataSourceRegistry
});
```

Inside the component:

```ts
@Component(...)
export class SupervisorPickerComponent {
  private users = inject(AgenticDataSources).get<UserQuery, UserResult>('users');

  protected suggestions = signal<readonly User[]>([]);
  async onPrefixChange(prefix: string) {
    const r = await this.users.adapter({ op: 'search', prefix, role: 'lead-counsel' });
    this.suggestions.set(r.users);
  }
}
```

`AgenticDataSources` is a thin injectable already in the lib; we add a typed `.get(name)` accessor and a per-widget validation that declared sources are present at mount time.

### How the API plumbing differs from existing tool calls

- **Tools** = LLM-initiated. Agent decides `bookFlight({...})` should run.
- **Data sources** = UI-initiated. The user types into an autocomplete; the widget queries the source directly. The agent never sees the calls (good for latency and cost).

Both end up calling the same backend endpoints; the registry lets you swap the implementation without changing the widget code (mock for dev, REST for prod, GraphQL for v2).

### What's new in the library

| | |
|---|---|
| `WidgetDef.dataSources?: string[]` | Optional declaration of registry names the widget needs |
| `AgenticDataSources.get<TQuery, TResult>(name)` | Typed accessor — currently exists; we add the runtime check that registered sources match the widget's declaration |
| `<maverick-widget-container>` | At mount time, verifies all declared sources are present; throws a clear error otherwise |

### Effort estimate
**Small.** ~3-4 days. Most of the plumbing is already in place; this is a typed accessor + a validation pass.

## Feature 3 — Interactive workflow (wizard)

### Scenario

The user types "Place a legal hold". Instead of one big form, the agent walks them through a four-step wizard:

```
Step 1 — Scope
   Pick keyword chips (autocomplete from past holds in this matter)
   → output: { keywords: ['Project Phoenix', 'budget overrun'] }

Step 2 — Custodians
   Multi-select from the matter's custodians; suggestions ordered by relevance
   to the keywords picked in step 1
   → output: { custodianIds: ['CUST-001', 'CUST-002', 'CUST-003'] }

Step 3 — Date range
   Date range picker; pre-filled with the matter's incident window
   → output: { from: '2024-09-01', to: '2025-03-31' }

Step 4 — Preview + send
   Renders the composed hold notice; one button to send
```

Each step's output is the next step's input. The agent can interject between steps ("This scope matches a hold from last quarter — re-use that template?" or "Custodian CUST-002 is on six other holds — confirm?"). Steps can branch (if zero custodians are selected, jump to "matter setup" instead).

### Library piece — `WorkflowRegistry`

A new top-level registry — same shape as the others (extends `RegistryBase<WorkflowDef>`). Each workflow def lists steps, each step references a widget and a transition rule:

```ts
agenticWorkflow({
  name: 'placeLegalHold',
  description: 'Guided wizard to draft, scope, and send a legal hold notice.',
  steps: [
    {
      id: 'scope',
      widget: 'keyword-chip-picker',
      next: 'custodians',                          // unconditional
    },
    {
      id: 'custodians',
      widget: 'custodian-multi-select',
      // Reactive — chooses next step based on prior step's output:
      next: (state) => state.custodians.length === 0 ? 'matter-setup' : 'date-range',
    },
    { id: 'date-range', widget: 'date-range-picker', next: 'preview' },
    { id: 'preview',    widget: 'hold-notice-preview', next: null },  // terminal
  ],
  onComplete: async (state, ctx) => {
    return await ctx.tools.placeLegalHold(state);   // calls the existing tool
  },
});
```

The renderer is a `<maverick-workflow-renderer>` — shows breadcrumb (steps), current widget, "Back" / "Next" controls. Maintains state in a signal so back-navigation preserves prior values.

The agent can:
- **Trigger a workflow** via a tool (`startWorkflow({name})`)
- **Interject** between steps via `text-delta` in the chat panel ("Note: re-using template from HOLD-094")
- **Override** a step transition via a `ui-action` event (A2UI-style, scoped to workflow context)

### Library piece — `ui-action` event

Already reserved in `AgenticEvent` for A2UI but not yet wired. This feature is the first concrete use:

```ts
// Server-emitted event
{ type: 'ui-action', actionId: 'workflow.transition',
  payload: { workflowId: 'placeLegalHold', to: 'preview', reason: 'all custodians on existing hold' } }
```

`ActionRegistry` (already present) routes this to a registered handler — the workflow renderer subscribes and applies the transition.

### What's new in the library

| | |
|---|---|
| `WorkflowRegistry` | New core registry; same `Registry<WorkflowDef>` base; conformance-tested |
| `<maverick-workflow-renderer>` | New component; subscribes to a workflow def + maintains step state |
| `ActionRegistry` integration | First production use of `ui-action` events; wires to workflow transitions |
| `agenticWorkflow({...})` factory | Defines workflow shape; mirrors `agenticTool` / `agenticForm` |

### Effort estimate
**Medium-large.** ~2 weeks. The renderer + state machine is the heavy lift; `WorkflowRegistry` and the `ui-action` wiring are smaller.

## Feature 4 — Human-in-the-loop approval flow

### Scenario

A paralegal asks the agent: *"Create production PROD-002 with all responsive non-privileged docs from January, deliver to opposing counsel."*

In the current demo this would execute immediately. In real eDiscovery — and in any regulated workflow — **delivery is irreversible**, and a paralegal doesn't have authority to send. So the agent should:

1. **Draft** the production set (calls `createProductionSet` → returns a draft, status = `pending-approval`).
2. **Notify** lead counsel (a routing rule based on persona + amount-at-risk).
3. **Render the diff** for the reviewer — what's about to be sent, who decided what, why.
4. Reviewer clicks **Approve** (or **Request changes** with a comment) — only then does the agent run `exportProductionSet`.
5. Every state transition (`drafted → reviewed → approved → executed`) is appended to the audit chain.

This is the **PR-style review pattern** for agent actions. Coding tools do this for code (Copilot Workspaces, Cursor agent mode). Enterprise apps need it for data mutations.

### Library piece — `ApprovalRegistry` + `pending-approval` state on tools

A new lightweight registry that pairs a **tool name** with an **approval policy**:

```ts
agenticApproval({
  tool: 'exportProductionSet',                          // intercepts this tool call
  required: (args, ctx) => ctx.persona !== 'lead-counsel',
  approverRoles: ['lead-counsel'],
  diffRenderer: 'production-summary-diff',              // ComponentRegistry name
  signoffMessage: (args) =>
    `Approve delivery of production ${args.productionId} to opposing counsel?`,
});
```

Behaviour change in the chat shell's `runUntilSettled` loop: when a tool call's name matches an approval-required entry AND the predicate returns true:

- The tool **does not execute**. Instead, a `pending-approval` event lands in the chat.
- A widget renders showing the diff + signoff prompt + approve/reject buttons.
- The persisted approval record (in PersistenceRegistry) lets the *reviewer* see it later from anywhere — e.g. a paralegal logs out, lead counsel logs in tomorrow, opens "Approvals queue", sees the pending item.
- On **Approve**, the same tool call resumes (with the approval id added to args for audit). On **Reject**, an `agent.notification` event tells the original requester with the reviewer's comment.

### How this differs from Feature 3 (workflow)

| Feature 3 — Workflow | Feature 4 — Approval |
|---|---|
| Single user, sequential steps | Multiple users, asynchronous handoff |
| State lives in the wizard component | State persists across sessions / users |
| Agent guides, user fills in | Agent drafts, reviewer accepts / rejects |
| Terminal state = "done" | Terminal state = "approved + executed" or "rejected" |

The two compose well: a Workflow can have an Approval gate at one of its steps (the wizard's "preview" step renders the approval prompt for a different reviewer).

### What's new in the library

| | |
|---|---|
| `ApprovalRegistry` | New core registry (registers approval policies per tool name) |
| `agenticApproval({...})` factory | Defines a tool-name → policy mapping |
| Chat-shell loop | Intercepts tool calls; routes through approval check before invocation |
| `<mvk-approval-card>` | Standalone widget showing diff + signoff + approve/reject |
| `<mvk-approval-queue>` page | Lists all pending approvals for the current user; route at `/approvals` |
| Audit-chain extension | `event.kind === 'tool-approved'` / `'tool-rejected'` adds to the existing tamper-evident chain |

### Effort estimate
**Medium-large.** ~2 weeks. Approval queue UI + chat-shell intercept + persistence + audit wiring. The trickiest part is the resume — the original chat thread "pauses" mid-turn; on approval the tool runs and the assistant continues as if nothing happened.

## Feature 5 — Long-running operations (LRO)

### Scenario

User asks the agent: *"Run TAR classification on the entire un-tagged corpus."* That's 50,000 documents. Real classification would take 8–20 minutes.

Current behaviour: the chat shell waits for `tool-call-result`. After ~30s the SSE stream times out, the user sees an incomplete response, the operation may or may not have actually completed.

Right behaviour:
1. Tool returns immediately with an **operation id** + estimated duration.
2. Chat shell renders a **progress widget** with: ETA, percentage, current phase (e.g. "scoring batch 23 / 100").
3. Operation continues server-side. User can navigate away, work on something else.
4. Server pushes `operation-progress` events as it advances; widget updates live.
5. On completion, widget collapses to a result summary + "View full report" link.
6. If the user closes the browser, comes back tomorrow, the operation appears in their **Operations panel** at any time.

### Library piece — `OperationRegistry` + `operation-*` event class

A new registry plus three new `AgenticEvent` types (additions, not replacements):

```ts
type AgenticEvent =
  | ...                                                          // existing
  | { type: 'operation-started'; opId: string; toolName: string;
      estDurationMs?: number; description: string }
  | { type: 'operation-progress'; opId: string; pct: number;
      phase?: string; partialResult?: unknown }
  | { type: 'operation-finished'; opId: string;
      result: unknown; durationMs: number }
  | { type: 'operation-failed'; opId: string;
      error: { code: string; message: string } };
```

Tools opt in by returning a special envelope:

```ts
agenticTool({
  name: 'runTARClassifier',
  schema: z.object({ unTaggedSetOnly: z.boolean(), topic: z.string().optional() }),
  longRunning: true,                                              // <-- opt-in
  handler: async (args, ctx) => {
    const opId = ctx.startOperation({ description: `TAR-classify ${args.topic ?? 'all'}` });
    // Kicks off the actual job; returns immediately
    void runClassifierBackground(args, opId, ctx);
    return { opId };                                              // not the result
  },
});
```

Inside `runClassifierBackground`, the tool calls `ctx.reportProgress(opId, {pct, phase})` periodically. On completion / failure, `ctx.completeOperation(opId, result)` or `ctx.failOperation(opId, err)` fires the matching event.

### Library piece — `<mvk-operation-progress>` + `<mvk-operations-panel>`

- **Progress widget** — renders inline in the chat; shows progress bar + ETA + phase + cancel button. Auto-collapses when complete.
- **Operations panel** — a route (`/operations`) listing all in-flight + recently-completed ops for the current user. Persisted via `PersistenceRegistry` + `OperationRegistry`.

### What's new in the library

| | |
|---|---|
| `OperationRegistry` | New core registry, persists ops across sessions |
| `tool-call.longRunning?: boolean` flag | Tool opts in to LRO behaviour |
| `ctx.startOperation / reportProgress / completeOperation / failOperation` | Tool-handler API for emitting LRO events |
| Three new `AgenticEvent` types | `operation-{started,progress,finished,failed}` |
| `<mvk-operation-progress>` | Inline progress widget |
| `<mvk-operations-panel>` page | List view of all ops |
| Server-side resume | If the chat-shell SSE drops mid-op, reconnecting fetches the current operation state (no missed updates) |

### Effort estimate
**Medium.** ~1.5 weeks. The event-class additions are small; the persistence + reconnection is the meat.

## Feature 6 — Multi-modal input (voice / image / file upload)

### Scenario

Three flavours, all common in production AI:

1. **Voice** — paralegal hits a microphone button, says *"Mark documents 7891234 and 7891236 as attorney-client privileged"*. Whisper (or browser-native `SpeechRecognition`) transcribes; the transcript is sent to the agent the same way as typed input.
2. **Image** — paralegal pastes a screenshot of a deposition exhibit, asks *"What custodian is this addressed to?"* The image is sent as a multimodal message part; the agent uses Gemini's vision to extract.
3. **File upload** — paralegal drags a `.pdf` into the chat: *"This is a new responsiveness rubric — apply it to the un-tagged set."* The PDF is uploaded, parsed (server-side text extraction), the parsed text becomes part of the agent's context.

### Library piece — extend the message shape on `AgenticBackend.run(input)`

Today: `messages: AgenticMessage[]` where content is a string. Extend to support multi-part content blocks (mirrors Anthropic / OpenAI / Gemini conventions):

```ts
type MessageContent =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mimeType: string; data: ArrayBuffer | string }   // base64 or buffer
  | { kind: 'file'; mimeType: string; filename: string; uri: string }; // server-uploaded

interface AgenticMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string | MessageContent[];                                  // string OR multi-part
}
```

The chat shell's composer gains:
- A microphone button (uses `SpeechRecognition` API; visualises waveform; falls back to "type instead" if unsupported).
- A paperclip button (file picker → upload to a configurable endpoint → message gets a `{kind: 'file', uri: ...}` part).
- Drag-and-drop on the chat panel + paste-image-from-clipboard for screenshots.

Each backend adapter translates the multi-part content into its protocol's native shape:
- AG-UI: passes through as-is (AG-UI spec already supports content parts).
- Hashbrown: wraps in Hashbrown's content-block format.
- A2UI: text-only fallback for now (with a clear warning).

### Library piece — server-side upload route

A new optional Hono handler `agUiUploadHandler({ onUpload })` that the agent server can mount at `/uploads`. Returns a signed URI the chat client embeds in a `{kind: 'file'}` content part. Files don't go through the SSE stream (would blow context), only URIs do.

### What's new in the library

| | |
|---|---|
| `MessageContent` union | New type for multi-part message bodies |
| `<mvk-chat-shell>` composer | Microphone, file picker, drag-and-drop |
| Audio waveform visualiser | Small standalone component (~120 LOC) |
| `agUiUploadHandler` | Optional server-side upload route |
| `MultiModalAdapter` | Per-backend translation; AG-UI passthrough, Hashbrown wrapper, A2UI text-fallback |
| Whisper integration *(optional)* | Server-side STT for non-Chromium browsers; keeps the lib browser-only by default |

### Effort estimate
**Medium-large.** ~1.5 weeks. The composer UI + upload plumbing is straightforward; the per-adapter content-part translation needs care to stay backward-compatible with text-only callers.

## Feature 7 — Chat-less, context-driven agentic interaction

### Scenario

The user is on `/custodians/CUST-001` (no chat panel open). The agent sees the route + selected custodian + persona, and proactively renders a **suggestion strip** at the top of the page:

> 🔍 Sarah Chen has 38 untagged documents from January 2025. **[Run TAR classifier]**
> 📄 No legal hold on Sarah Chen — she appears in 4 holds for related custodians. **[Place hold]**
> ⏰ Last collection: 14 days ago. **[Refresh from sources]**

The user clicks **[Run TAR classifier]** → the same tool the agent would call from chat runs, the result widget renders in the page (not in chat). No chat turn, no LLM streaming.

Or the agent runs **proactively** with confirmation: "About to refresh collection for Sarah Chen — 14 days since last refresh. **[Confirm]** **[Skip]**". This is the "ambient agent" pattern.

### Library piece — `AgentContextStream`

A new injectable that exposes the **current UI context** as a signal:

```ts
interface AgentContext {
  readonly route: string;                          // '/custodians/CUST-001'
  readonly routeParams: Record<string, string>;    // { custodianId: 'CUST-001' }
  readonly selection?: { type: string; id: string }; // { type: 'custodian', id: 'CUST-001' }
  readonly persona: string;
  readonly registries: { tools: string[]; widgets: string[] };  // currently visible after scope policy
}

@Injectable({ providedIn: 'root' })
export class AgentContextStream {
  readonly context = signal<AgentContext>({...});
  // Apps push into the signal from their router; library provides defaults
  // (route + selection are auto-tracked from Angular Router; persona from
  // PersonaService; registries from setScopePolicy reads).
}
```

### Library piece — `provideContextDrivenAgent({...})`

Wires the context signal to a server-side observer. When context changes:
- Host POSTs the new context to `/agents/observer/context` (an endpoint on the agent server)
- Agent server runs an **ObserverAgent** — a Gemini specialist that takes context as input, returns a **list of suggestions** (each with text + a referenced tool name + args)
- Client renders suggestions in a side panel or top strip

Server-side wiring uses the same orchestrator pattern but with a different specialist. The ObserverAgent is rate-limited (don't fire on every keystroke) and debounced — typical 1 call per 30s of stable context.

### Library piece — `<mvk-suggestion-strip>` component

A small standalone component the host mounts at the top of any route. Listens for `agent.suggestions` events on the SSE stream from the observer; renders each as a chip with optional preview-on-hover, click triggers the bound tool.

### Why this is the chat-less path

- **No chat input.** The user never types. Suggestions appear because the agent saw the context.
- **No streaming text.** Suggestions are JSON, not prose. Predictable, low-latency.
- **Per-context.** Context-bound tools (e.g. "place hold for THIS custodian") have their args pre-filled from the context; user clicks once.
- **Opt-in per route.** Apps mount `<mvk-suggestion-strip>` on routes where ambient suggestions make sense; skip on routes where they'd distract.

### What's new in the library

| | |
|---|---|
| `AgentContextStream` | New injectable; signal of current UI context (route, selection, persona) |
| `provideContextDrivenAgent({...})` | Wires the context signal to an observer endpoint; configures debounce + rate limit |
| `<mvk-suggestion-strip>` | Standalone component to mount on any route |
| `ObserverAgent` (server-side) | New specialist class in `@maverick/agentic-ui-server`; debounce + suggestion-list output |
| `ContextRegistry` (optional v2) | If multiple apps want to publish + consume context, a registry of named context providers |

### Effort estimate
**Large.** ~2.5 weeks. Server-side specialist + client-side observer + UI component + app wiring. The most novel feature on the list.

## Feature 8 — Replay + undo of agent actions

### Scenario

A paralegal asks the agent to release HOLD-002 (because it looks redundant). The agent does it. Five minutes later, the senior counsel realises HOLD-002 was actually still needed for a different production. They want to:

1. **See exactly what happened** — *which agent action released the hold, with what justification, when, by whom?* (Visibility — already partly covered by Phase 5's tamper-evident chain.)
2. **Undo it** — restore HOLD-002 to its pre-release state. Custodians re-bound, scope re-applied, audit chain showing both the release AND the undo as an explicit reversing event (no rewriting history).
3. **Replay the flow** — for compliance review, walk through the steps the agent took, in order, with the inputs and outputs of each tool call.

This is the **audit-grade reversibility** pattern. The eDiscovery audit chain logs what happened; replay + undo lets you act on it.

### Library piece — extend `agenticTool` with an inverse + replay metadata

Tools that mutate state opt in to undo by declaring an inverse handler:

```ts
agenticTool({
  name: 'releaseLegalHold',
  schema: z.object({ holdId: z.string(), reason: z.string() }),
  handler: async ({ holdId, reason }, ctx) => { /* ...mutate... */ },
  // Inverse: takes the original args + the result, restores prior state.
  inverse: async ({ holdId }, prevResult, ctx) => {
    return runInInjectionContext(ctx.env, () => {
      const store = ctx.env.get(MatterStore);
      store.restoreLegalHold(prevResult.before);
      return { restored: holdId };
    });
  },
});
```

When the tool runs, the chat shell records the call in an **OperationLog** (`PersistenceRegistry`-backed): `{toolName, args, result, before, after, timestamp, actor, threadId}`. Each entry gets an undo button in the UI.

### Library piece — `<mvk-agent-history>` page

A new route (`/agent-history`) lists every agent action in the current matter. Each row shows:
- Timestamp, actor, tool name, args summary, outcome (success / failure / undone)
- A **diff view** (before vs after, rendered by the same diffRenderer Feature 4 uses for approvals)
- An **Undo** button (only present if `inverse` was declared on the tool)
- A **Replay** button — shows the conversation that led to this action, plays it back as a read-only chat transcript

### Library piece — `OperationLog`

Persists across sessions. Read by the history page; written by the chat-shell loop on every tool call (success and failure both). Pairs with the existing audit chain — audit chain proves *integrity*, OperationLog provides the *interactive* view.

### What's new in the library

| | |
|---|---|
| `ToolDef.inverse?: (args, prevResult, ctx) => Promise<unknown>` | Optional inverse handler for undoable tools |
| `OperationLog` | Persisted log of every tool call; injectable + signal-backed |
| `<mvk-agent-history>` page | List + diff + undo + replay UI |
| `<mvk-action-replay>` modal | Shows the conversation that produced an action |
| Audit chain extension | New event `kind === 'tool-undone'` linking back to the original `tool-executed` event |

### Effort estimate
**Medium.** ~1.5 weeks. Most tools either trivially inverse (the eDiscovery demo's mutations all have natural inverses) or explicitly cannot be undone (`exportProductionSet` after delivery — flag at registration time, hide undo button).

### How it pairs with feature 4 (approval)
Approval **prevents** mistakes for high-stakes actions; replay + undo **recovers from** mistakes for everyday actions. Most actions don't need approval gates but should still be undoable. The cost of always requiring approval is friction; undo is the cheap-feeling safety net for routine work.

## Sequence diagram — feature 7 in action

```mermaid
sequenceDiagram
    actor User
    participant Router as Angular Router
    participant Stream as AgentContextStream
    participant Server as Agent server<br/>(ObserverAgent)
    participant Strip as &lt;mvk-suggestion-strip&gt;
    participant ToolRegistry

    User->>Router: navigates to /custodians/CUST-001
    Router-->>Stream: context updates (route + params)
    Stream->>Server: POST /agents/observer/context (debounced 1.5s)
    Server-->>Server: ObserverAgent runs Gemini call
    Server-->>Strip: SSE event<br/>agent.suggestions: [tagDocs, placeHold, refresh]
    Strip->>User: renders 3 chips at top of page
    User->>Strip: clicks "Run TAR classifier"
    Strip->>ToolRegistry: ToolRegistry.get('runTARClassifier')
    Strip->>Strip: invokes handler with context-bound args
    Strip-->>User: TAR-scores widget renders inline
```

## Phased delivery

Each feature is independently shippable. Suggested order, with dependencies:

| # | Feature | Depends on | Lib changes | Demo changes |
|---|---|---|---|---|
| 1 | Composable intake form | Existing FormRegistry | Add `composition` field + composing renderer + tiny `if` evaluator | New `custodianIntake` form; replace the existing static intake |
| 2 | APIs from dynamic UI | Feature 1 (uses dynamic widgets) | Typed `AgenticDataSources.get<>()` accessor + widget-time validation | Add `users` and `departments` data sources; consume them in two intake widgets |
| 3 | Interactive workflow | Existing ActionRegistry + Feature 2 | New `WorkflowRegistry` + renderer + `ui-action` wiring | New `placeLegalHold` workflow; replace the current single-shot tool |
| 4 | Human-in-the-loop approval | Phase 5 audit chain + Feature 3 (gate fits in a workflow step) | New `ApprovalRegistry` + chat-shell intercept + `<mvk-approval-card>` + `/approvals` route | `exportProductionSet` and `releaseLegalHold` go through approval when invoked by a paralegal persona |
| 5 | Long-running operations | New `OperationRegistry` + `PersistenceRegistry` for cross-session resume | Three new event types (`operation-{started,progress,finished}`) + `<mvk-operation-progress>` widget + `/operations` page | `runTARClassifier` becomes long-running; widget streams progress |
| 6 | Multi-modal input | Per-backend translation; AG-UI passes through, Hashbrown wraps, A2UI text-fallback | `MessageContent` union + composer mic/file controls + `agUiUploadHandler` | Voice input on the chat composer; drag-and-drop a deposition .pdf into chat |
| 7 | Chat-less context-driven agent | Feature 4 (so context-bound actions can flow through approval) | New `AgentContextStream` + `ObserverAgent` (server) + `<mvk-suggestion-strip>` | Mount strip on `/custodians/:id` and `/documents/:id`; suggestions trigger tools/workflows |
| 8 | Replay + undo | Phase 5 audit chain + `OperationLog` | `ToolDef.inverse?` field + `<mvk-agent-history>` page + `<mvk-action-replay>` modal | Every mutating tool gets an inverse; `/agent-history` page lists everything the agent has done in the matter |

Estimated total: **~12 weeks of focused engineering** for one developer (~6 weeks for the original 1–4, ~6 weeks for the additions 5–8). Each feature ships with a Playwright spec + a cookbook entry, so the work is self-contained and reviewable per increment.

## Verification per feature

| Feature | E2E test |
|---|---|
| 1. Composable intake | Switch persona → assert the supervisor-signoff section appears/disappears |
| 2. APIs from UI | Type into department autocomplete → assert the suggestions list populates from the mock data source |
| 3. Workflow | Walk through the four-step `placeLegalHold` wizard end-to-end → assert the legal hold lands in the data layer with the right shape |
| 4. Approval | As paralegal, kick off `exportProductionSet` → assert the chat shows `pending-approval` and the production didn't ship; switch to lead-counsel persona, navigate to `/approvals`, click Approve → assert the production export ran and audit chain has both events |
| 5. LRO | Trigger `runTARClassifier` (mock with a 5s sleep + progress emits) → assert the progress widget renders, percentage advances, completion summary appears, AND the `/operations` page lists it |
| 6. Multi-modal | Upload a PDF via the composer → assert the agent receives a `{kind: 'file'}` content part and references it in its response (LLM-call test, gated by Gemini quota); voice path tested with a mock SpeechRecognition |
| 7. Chat-less | Navigate to `/custodians/CUST-001` → wait for suggestion strip → assert at least one chip appears → click it → assert the bound tool runs |
| 8. Replay + undo | After test 1's intake completes, navigate to `/agent-history` → click Undo on the addCustodian entry → assert custodian removed AND audit chain has both events linked |

Each test is LLM-free where possible (intake + workflow + approval + LRO + undo can use the in-process echo agent for transitions). Only feature 7's "Observer" path and feature 6's image/file paths require a real LLM call.

## Risks and open questions

### R1 — Composition expression DSL bloat
The `if` expression on form composition steps is intentionally tiny (`===`, `!==`, `&&`, `||`, dotted access). Risk: someone wants short-circuit, regex, function calls, etc. Mitigation: hard-cap the AST shape; reject anything outside the spec. If real consumers need more, ship a `predicate: (ctx) => boolean` callback as the escape hatch.

### R2 — `WorkflowRegistry` overlaps with existing form/action registries
There's a real question of whether a workflow IS just an ordered list of forms. Mitigation: design `WorkflowRegistry` as a thin coordinator over `FormRegistry` + `ActionRegistry`. If after implementation the registry has no unique state of its own, fold it back into FormRegistry's composition feature (feature 1).

### R3 — Observer agent cost + privacy
ObserverAgent fires Gemini calls on every meaningful context change. Cost grows linearly with users. Privacy: route + selection details may include sensitive ids. Mitigation: aggressive debounce (≥30s stable context before firing), opt-in per route, redaction of ids in the prompt before sending to Gemini.

### R4 — Suggestion strip becomes noise
If the strip always shows three suggestions, users learn to ignore it. Mitigation: confidence threshold — ObserverAgent emits a confidence per suggestion, strip only shows ≥0.7. Empty strip = no UI, not "no suggestions".

### R5 — UI-action security boundary
A `ui-action` event with `op: 'workflow.transition', to: 'preview'` is benign. A `ui-action` with `op: 'execute', tool: 'redactDocument'` would be a tool call by another name — bypassing scope policy if not careful. Mitigation: the `ActionRegistry` predicate applies to actions just as `setScopePolicy` does to tools. ADR write-up: actions are tools-by-another-name; same scope policy applies.

### R6 — Approval queue becomes a black hole
If reviewers don't act on pending approvals, the system stalls. Mitigation: notification routing (email / Slack / in-app badge), per-approval SLA timeouts that escalate, and an "auto-approve with audit note" option for low-risk gates that need a record-keeping decision but not a discretionary one.

### R7 — LRO state survives chat-shell crash
If the user closes the browser mid-operation, server keeps running. When they come back, can they resume the chat thread *with* the in-progress operation re-attached? Mitigation: `OperationRegistry` keys ops by `(threadId, opId)` so reconnecting a thread auto-fetches in-flight ops. Mature pattern from cloud APIs.

### R8 — Inverse handlers can lie
If a tool's `inverse` doesn't actually restore prior state (bug, oversight, cross-store dependency), Undo gives a false sense of safety. Mitigation: every tool's `inverse` must be conformance-tested via a `roundTrip()` helper in `/testing` — call tool, snapshot store, call inverse, assert store equals snapshot. Surface failures at registration time, not at runtime.

### R9 — Multi-modal cost + content moderation
Image / voice inputs hit larger per-call costs. Voice transcripts may carry PII. Mitigation: redaction layer in the upload handler before forwarding to the LLM (configurable allow-list of fields); per-modality cost tracking surfaced in the telemetry sink (so apps can budget).

## Open question for review

**Should feature 7 (chat-less context agent) be its own example app, or live inside the eDiscovery flagship?** Putting it in the flagship demonstrates the cumulative pattern (chat + ambient suggestions in one app, the user can choose). Splitting it isolates the new pattern for review. The plan above assumes "in flagship"; flag if you'd prefer split.

**Should features 4 (approval) and 8 (undo) ship together as a "governance bundle"?** They're conceptually paired — approval prevents mistakes, undo recovers from them. Shipping them in adjacent commits with a single cookbook entry tells a stronger story to compliance reviewers.

## On confirmation, implementation order

If approved, my recommended sequence:

| Week | Feature(s) | Notes |
|---|---|---|
| 1.5 | **Feature 1** — Composable intake | Smallest blast radius, biggest visible change. Foundation for 2 + 3. |
| 2 | **Feature 2** — Live data fetching | Tiny lib change; wires through feature 1's widgets. |
| 4 | **Feature 3** — Workflow | Largest single feature in the original four; needs 1+2 in place. |
| 6 | **Feature 4** — Approval | Uses workflow's state machine + the existing audit chain. Compose well together. |
| 7.5 | **Feature 5** — LRO | Independent capability; no dependency on prior features besides PersistenceRegistry. |
| 9 | **Feature 6** — Multi-modal | Independent; touches the chat composer + AG-UI adapter. Real-LLM gated. |
| 11 | **Feature 7** — Chat-less observer | Best done after approval (so context-bound actions can flow through approval). Real-LLM gated; budget Gemini quota. |
| 12 | **Feature 8** — Replay + undo | Cross-cutting; needs the audit chain mature and most mutating tools registered. Lands last so it can index everything. |

Each increment lands as its own commit + cookbook entry + Playwright spec, so the deck, User Guide, and demo deck can absorb the new patterns one at a time.

### Quick decision points before we start

1. **Confirm scope** — all 8, or hold features 6 (multi-modal) + 7 (chat-less) for v3? They're the most technically novel + LLM-cost-heavy.
2. **Confirm ordering** — happy with the dependency-first ordering above, or want to lead with a different feature for demo impact?
3. **Confirm DSL escape hatch (R1)** — tiny declarative `if` only, or also accept a `predicate: (ctx) => boolean` callback?
4. **Confirm flagship-vs-split for feature 7** (the open question above).

## Documentation footprint after all 8 features ship

For visibility, here's the expected end-state of the public docs after the implementation completes:

### README

| Section | Today (10 use cases) | After r2 (18 use cases) |
|---|---|---|
| Use-cases matrix | 10 rows | **18 rows** — adds composable form, live data fetch, workflow, approval, LRO, multi-modal, chat-less, undo |
| Problem statement (architect view) | 6 axes | **8 axes** — adds "Governance through approval gates" and "Reversibility / undo" |
| Hero animation (GIF) | One scene (custodian add) | Refreshed at least twice — once after Feature 4 (shows approval gate), once after Feature 5 (shows LRO progress bar) |
| Static screenshots in `docs/assets/` | 8 | ~14 — one new shot per feature for the deck slides |

### Deck (`agentic-ui-overview.pptx`)

| Today | After r2 |
|---|---|
| 62 slides | ~78 slides |
| Section 5b (Use cases) — 11 slides | **19 slides** — matrix + 18 spotlights, one per use case (mirrors the README order) |
| Section 6 (Examples) — 4 slides | **8 slides** — adds 4 captured screenshots: approval card, operations panel, multi-modal composer, agent-history page |
| Section 6 (Compliance) | Existing 4 slides + a new **Governance bundle** slide pairing approval (prevention) with undo (recovery) |

### Cookbook

Eight new walkthrough entries, one per feature:

```
docs/cookbook/composable-intake-form.md          # feature 1
docs/cookbook/widgets-with-live-data.md          # feature 2
docs/cookbook/interactive-workflows.md           # feature 3
docs/cookbook/approval-flow.md                   # feature 4
docs/cookbook/long-running-operations.md         # feature 5
docs/cookbook/multi-modal-input.md               # feature 6
docs/cookbook/ambient-context-agent.md           # feature 7
docs/cookbook/replay-and-undo.md                 # feature 8
```

Each follows the existing `paralegal-mcp-review.md` template: scenario → architecture → wiring code → "what's new in the library" table → verification.

### User Guide

The `## Use cases` section in `docs/USER_GUIDE.md` follows the README matrix — same 18 rows, same anchor links, same audience tags.

### What gets updated INSIDE each commit

Every feature commit will include:
1. The library + demo + test code (the capability itself)
2. The cookbook entry for that feature
3. README's "Use cases" matrix gets one new row
4. Deck regenerated with that feature's spotlight slide added
5. `docs/distributions/agentic-ui-codebase.zip` refreshed (the email-friendly snapshot)
6. If the flow visibly changes the chat panel, `agentic-ui-in-action.gif` is regenerated

This is the same Definition of Done from the Goals section above, repeated here for emphasis: **README + deck are not done in a separate "docs sprint" at the end** — each feature ships with its docs in the same set of commits, or it doesn't ship.
