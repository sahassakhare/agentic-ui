import type { Type } from '@angular/core';
import type { ZodTypeAny } from 'zod';
import type { AgenticBackend } from './agentic-backend';

/**
 * Discriminator for where a registry entry came from. Drives MFE-aware
 * teardown via `Registry.removeBySource()` — when a remote unloads, the
 * orchestrator calls `removeBySource('remote:<name>')` once and every
 * registry strips the matching entries in one pass.
 */
export type CapabilitySource = 'host' | 'user' | `team:${string}` | `remote:${string}` | `mcp:${string}` | `external:${string}`;

/**
 * A dependency a capability declares on another capability. Consumed by the
 * capability-graph resolver (`resolveCapabilityGraph`) to build the
 * dependency DAG the Experience Planner traverses — the substrate that lets
 * the platform "traverse the graph instead of loading static workflows"
 * (AEP Seam A).
 *
 * A requirement selects a target either **by exact `name`** (single, pinned
 * implementation) or **by `tag`** (late binding — any capability of `kind`
 * carrying the tag satisfies it, which is how one requirement can resolve to
 * *multiple* implementations of the same capability). Set `name` XOR `tag`;
 * when both are set `name` wins and `tag` is ignored.
 *
 * `kind` names the capability family (and hence which registry the resolver
 * searches): `'tool'`, `'component'`, `'form'`, `'dataSource'`, `'capability'`,
 * `'prompt'`, `'skill'`, `'knowledge'`, `'policy'`, or any adopter-defined
 * string.
 *
 * @example
 * ```ts
 * // Conflict-check needs the customer entity and produces a conflict status.
 * const conflictCheck = {
 *   name: 'conflictCheck',
 *   requires: [{ kind: 'dataSource', name: 'customerEntity', reason: 'lookup parties' }],
 *   produces: ['conflict-status'],
 * };
 * ```
 */
export interface CapabilityRequirement {
  /** Capability family / registry to resolve against ('tool', 'form', …). */
  readonly kind: string;
  /** Exact target capability name. Set this XOR `tag`. */
  readonly name?: string;
  /** Late-binding selector: any `kind` capability tagged with this. Set XOR `name`. */
  readonly tag?: string;
  /** When true, an unmet requirement is reported but does not block the graph. */
  readonly optional?: boolean;
  /** Human/audit-facing explanation of why the dependency exists. */
  readonly reason?: string;
}

/**
 * Common shape every registry entry shares. The uniform `name` lets registries
 * use the same lookup/dispose machinery regardless of TDef payload.
 */
export interface RegistryEntry {
  /** Unique key within the registry. Tool name, component name, etc. */
  readonly name: string;
  /** Where the entry came from. Defaults to `'host'` when omitted. */
  readonly source?: CapabilitySource;
  /**
   * Optional governance tags. The values are opaque strings the
   * consumer's `RegistryBase.setScopePolicy(...)` decides how to
   * interpret — typically role names ('paralegal', 'lead-counsel'),
   * environment markers ('production'), or feature gates.
   *
   * When unset, the policy treats the entry as visible in every
   * scope (no opinion). When set, the policy decides whether the
   * active scope intersects with this list.
   *
   * @example
   * ```ts
   * agenticTool({
   *   name: 'releaseLegalHold',
   *   description: '…',
   *   schema: z.object({ holdId: z.string(), reason: z.string() }),
   *   handler,
   *   scopes: ['lead-counsel'],   // Only counsel may release a hold
   * })
   * ```
   */
  readonly scopes?: readonly string[];
  /**
   * Optional cleanup hook called when this entry is removed — by an
   * explicit disposer, by `removeBySource()` (e.g. when an MFE unloads),
   * or because a registration with the same name replaced it under a
   * `'replace'` conflict policy.
   *
   * Use it to release timers, unsubscribe observers, abort in-flight
   * fetches, etc., that the entry's owner started. Errors thrown from
   * `onDispose` are caught and routed to the telemetry sink so a single
   * misbehaving entry can't poison the rest of a teardown sweep.
   *
   * @example
   * ```ts
   * agenticTool({
   *   name: 'pollSubmissions',
   *   schema: z.object({ ... }),
   *   handler: async () => { ... },
   *   onDispose: () => clearInterval(pollHandle),
   * })
   * ```
   */
  readonly onDispose?: () => void | Promise<void>;
  /**
   * Optional semver-range expressing which host (`@infra-tools/agentic-ui`)
   * versions this entry expects. When set, `RegistryBase.register()`
   * evaluates the range against the lib's compile-time `LIB_VERSION` and
   * SKIPS registration with a telemetry-logged warning when the host
   * doesn't satisfy the range.
   *
   * Supported syntax: `1.2.3`, `^1.2.3`, `~1.2.3`, `>=1.2.3`, `>1.2.3`,
   * `<2.0.0`, `<=1.5.0`. See `satisfies()` in `semver-match.ts` for
   * the full list. Unsupported ranges (compound, pre-release, x-range)
   * silently return `false` — the entry is treated as incompatible.
   *
   * Capability M1 R5 — ADR-014.
   *
   * @example
   * ```ts
   * agenticTool({
   *   name: 'releaseLegalHold',
   *   description: '…',
   *   schema: z.object({ holdId: z.string() }),
   *   handler,
   *   requiredHostVersion: '^1.0.0',  // Compatible with v1.x
   * })
   * ```
   */
  readonly requiredHostVersion?: string;
  /**
   * Free-form tags for catalog filtering. Opaque to the runtime; used
   * by the future control-plane catalog (Tier 2 in the v3 plan) for
   * search + lifecycle filtering. Common values: `'beta'`, `'preview'`,
   * a domain name (`'eDiscovery'`, `'bookings'`), a team
   * (`'platform-team'`).
   *
   * Capability M1 R5 — ADR-014.
   */
  readonly tags?: readonly string[];
  /**
   * Owning team / squad / individual identifier — opaque to the
   * runtime, used by the catalog for accountability. Typical shape:
   * `'team:platform'`, `'@sahassakhare'`, `'compliance@example.com'`.
   *
   * Capability M1 R5 — ADR-014.
   */
  readonly owner?: string;
  /**
   * Lifecycle status. Opaque to `register()` itself but available to
   * scope policies + the control-plane catalog. A persona-scope
   * predicate could hide `'deprecated'` entries from production
   * personas, for example, or refuse to ship a remote that has
   * `'draft'` capabilities.
   *
   * Capability M1 R5 — ADR-014.
   */
  readonly lifecycle?: 'draft' | 'published' | 'deprecated' | 'disabled';
  /**
   * Capabilities this entry depends on. Consumed by `resolveCapabilityGraph`
   * to build the dependency DAG (AEP Seam A). Omit for a leaf capability —
   * the default, and identical to pre-Seam-A behaviour. Purely additive:
   * `register()` never reads this field, so a missing resolver target does
   * not block registration; it surfaces as an `unmet` requirement in the
   * graph the planner can act on.
   */
  readonly requires?: readonly CapabilityRequirement[];
  /**
   * Semantic outputs this capability produces (opaque string labels, e.g.
   * `'conflict-status'`, `'customer-entity'`). Lets an experience/plan express
   * "I need whatever produces X" and lets viz/audit explain data flow. Opaque
   * to the runtime; consumed by the capability graph + Experience Planner.
   */
  readonly produces?: readonly string[];
}

/**
 * A client-executable tool the agent can call. The Zod schema validates
 * arguments before the handler runs; the handler returns the tool result the
 * agent will see on its next turn.
 *
 * Generic params let the factory `agenticTool({...})` infer `args` types from
 * the schema; the runtime erases them when stored in `ToolRegistry`.
 */
export interface ToolDef<TArgs = unknown, TResult = unknown> extends RegistryEntry {
  /** Human-readable description shown to the LLM. */
  readonly description: string;
  /** Zod schema for the tool's argument shape. */
  readonly schema: ZodTypeAny;
  /** Async handler invoked by the orchestrator after schema validation. */
  readonly handler: (args: TArgs, ctx: ToolContext) => Promise<TResult>;
  /**
   * Where the handler should run. `'host'` (default) executes in the host
   * app's injection context. `'remote'` indicates the handler relies on
   * services provided by an MFE remote — the orchestrator will route the
   * call into the remote's captured `EnvironmentInjector`.
   */
  readonly executeIn?: 'host' | 'remote';
  /**
   * Capability F5 opt-in (r3 plan §9.5). When `true`, the tool's handler
   * is expected to:
   *   1. Call `ctx.startOperation({...})` to mint an opId.
   *   2. Kick off background work and return promptly with at minimum
   *      `{ opId }` (typically as part of a result that also surfaces
   *      a progress widget).
   *   3. Periodically call `ctx.reportProgress(opId, {...})`, then
   *      `ctx.completeOperation(opId, result)` or
   *      `ctx.failOperation(opId, err)` on terminal state.
   *
   * The flag is informational for tooling (telemetry, the `/operations`
   * route's classification, MCP tool descriptions). The chat shell does
   * not require it to be set — calling `startOperation` on any tool
   * works — but setting it lets surfaces show "this tool may take time"
   * affordances proactively.
   */
  readonly longRunning?: boolean;
}

/** Context passed to every tool handler. */
export interface ToolContext {
  /** Conversation thread id this tool call belongs to. */
  readonly threadId: string;
  /** Run id (one user turn) this tool call belongs to. */
  readonly runId: string;
  /** Unique id for this specific tool invocation. */
  readonly toolCallId: string;
  /** Signal that fires when the user / orchestrator aborts the run. */
  readonly signal: AbortSignal;
  /**
   * Capability F5 — start a long-running operation (r3 plan §9.5).
   * Returns the generated `opId` the tool forwards into background work.
   * Persists the operation in `OperationRegistry` so the
   * `<mvk-operation-progress>` widget and `/operations` page see it
   * immediately; emits the `operation-started` audit event.
   *
   * Always present on the context. Tools that don't use LRO ignore it.
   */
  startOperation(meta: OperationStartMeta): string;
  /** Capability F5 — emit a progress update for a started operation. */
  reportProgress(opId: string, progress: OperationProgress): void;
  /** Capability F5 — terminal-success transition. */
  completeOperation(opId: string, result: unknown): void;
  /** Capability F5 — terminal-failure transition. */
  failOperation(opId: string, error: OperationError): void;
}

/**
 * A renderable Angular component the agent can ask for by name (generative UI).
 * The chat shell's `<mvk-widget-container>` resolves and renders these via
 * `*ngComponentOutlet`.
 */
export interface ComponentDef extends RegistryEntry {
  /** Standalone Angular component class. */
  readonly component: Type<unknown>;
  /** Zod schema for the component's `@Input()` props. */
  readonly propsSchema: ZodTypeAny;
  /**
   * Names of `DataSourceRegistry` entries this widget consumes (Capability F2).
   *
   * Mount-time machinery (`<mvk-widget-container>` and the composition branch
   * of `<mvk-form-renderer>`) verifies every declared name resolves before
   * instantiating the widget. A missing source produces an actionable error /
   * placeholder, not a silent broken widget.
   *
   * Widgets read declared sources via `inject(DataSourceRegistry).getTyped(...)`.
   *
   * @example
   * ```ts
   * agenticWidget({
   *   name: 'supervisor-signoff-picker',
   *   component: SupervisorPickerComponent,
   *   propsSchema: z.object({ matterId: z.string() }),
   *   dataSources: ['users'],
   * });
   * ```
   */
  readonly dataSources?: readonly string[];
}

/**
 * Registration metadata for a backend adapter. The `factory` is invoked by
 * `BackendRegistry.resolveActive()` lazily — once per active selection.
 */
export interface BackendDef extends RegistryEntry {
  /** Stable id used by `BackendRegistry.setActive(id)`. */
  readonly id: string;
  /** Display label for backend-switch UI. */
  readonly label: string;
  /** Factory for the concrete `AgenticBackend` instance. */
  readonly factory: () => AgenticBackend;
  /** Feature flags the chat shell uses for capability detection. */
  readonly capabilities: BackendCapabilities;
}

/**
 * Feature flags advertised by an `AgenticBackend`. The chat shell hides UI
 * elements that depend on capabilities the backend doesn't claim — e.g., the
 * tools sidebar is hidden when `clientTools=false`.
 */
export interface BackendCapabilities {
  /** Backend streams events incrementally (vs single-response). */
  readonly streaming: boolean;
  /** Backend supports client-side tool execution. */
  readonly clientTools: boolean;
  /** Backend can request component rendering (generative UI). */
  readonly generativeUi: boolean;
  /** Backend emits `ui-action` events (A2UI-style). */
  readonly uiActions: boolean;
  /**
   * Backend accepts multi-modal `MessageContent[]` (Capability F6 — r3
   * plan §9.6). When `false` (or omitted), the chat shell warns and
   * either text-only fallbacks or refuses non-text content.
   */
  readonly multiModal?: boolean;
}

/**
 * Capability manifest a remote MFE publishes. Lists the names of tools,
 * components, actions, forms, and prompts it contributes — the host can
 * read this *before* loading the remote bundle (e.g., when building the
 * agent's system prompt).
 */
export interface CapabilityManifest {
  /** Remote name (matches the federation manifest key). */
  readonly remoteName: string;
  /** Semver version string. */
  readonly version: string;
  /** Names of the entries the remote contributes, by registry. */
  readonly exposes: {
    readonly tools: readonly string[];
    readonly components: readonly string[];
    readonly actions?: readonly string[];
    readonly forms?: readonly string[];
    readonly prompts?: readonly string[];
    /** ADR-045 triggers contributed by this remote. */
    readonly triggers?: readonly string[];
    /** ADR-044 dashboard templates contributed by this remote. */
    readonly dashboards?: readonly string[];
    /** Post-chat-surfaces P5 playbooks contributed by this remote. */
    readonly playbooks?: readonly string[];
    /** AEP Seam C experiences contributed by this remote. */
    readonly experiences?: readonly string[];
    /** AEP Seam B skills contributed by this remote. */
    readonly skills?: readonly string[];
    /** AEP Seam B knowledge sources contributed by this remote. */
    readonly knowledge?: readonly string[];
    /** AEP Seam B memory providers contributed by this remote. */
    readonly memory?: readonly string[];
    /** AEP Seam B workflows contributed by this remote. */
    readonly workflows?: readonly string[];
    /** AEP Seam B navigation entries contributed by this remote. */
    readonly navigation?: readonly string[];
  };
  /** Optional URL of the manifest document (if loaded out-of-band). */
  readonly manifestUrl?: string;
}

/**
 * Indexable record stored in `CapabilityRegistry`. `name === remoteName` so
 * registry lookups (`byRemote`, `forTool`) work uniformly.
 */
export interface CapabilityDef extends RegistryEntry, CapabilityManifest {
  /* `name === remoteName` for registry indexing. */
}

// ─── Extended registries (M4) ────────────────────────────────────────────────

/** Context passed to every action effect. */
export interface ActionContext {
  /** Thread id on which the action was issued. */
  readonly threadId: string;
  /** Run id on which the action was issued. */
  readonly runId: string;
  /** Unique id for this specific action invocation. */
  readonly actionId: string;
  /** Aborts when the user / orchestrator stops the run. */
  readonly signal: AbortSignal;
}

/**
 * NgRx-style command dispatched from a `ui-action` event (A2UI) or directly
 * by the host. Effects run after the payload passes the Zod validator.
 */
export interface ActionDef<TPayload = unknown> extends RegistryEntry {
  /** Discriminating type string (e.g., 'navigate', 'addToCart'). */
  readonly type: string;
  /** Human-readable description for tooling and prompts. */
  readonly description: string;
  /** Zod schema for the payload. */
  readonly payloadSchema: ZodTypeAny;
  /** Side-effecting handler. May be sync or async. */
  readonly effect: (payload: TPayload, ctx: ActionContext) => void | Promise<void>;
}

/** Where an intent routes when matched. */
export type IntentTarget =
  | { readonly kind: 'tool'; readonly target: string }
  | { readonly kind: 'action'; readonly target: string }
  | { readonly kind: 'route'; readonly target: string };

/**
 * Maps a natural-language intent to a tool/action/route. Used to short-circuit
 * common phrases pre-LLM (latency-sensitive flows) and to feed structured
 * intent metadata into the system prompt.
 */
export interface IntentDef extends RegistryEntry {
  /** Stable id for cross-references. Matches `name`. */
  readonly id: string;
  /** Human-readable description. */
  readonly description: string;
  /** Sample phrases that should activate this intent. */
  readonly examples: readonly string[];
  /** Zod schema for the slots/parameters extracted from the user phrase. */
  readonly schema: ZodTypeAny;
  /** Where the intent dispatches. */
  readonly mapsTo: IntentTarget;
}

/** Per-field UI hints the form renderer applies to a `FormDef`'s fields. */
export interface FormFieldUi {
  /** Render order; lower numbers render first. */
  readonly order?: number;
  /** Input type override; defaults to text. */
  readonly widget?: 'text' | 'textarea' | 'number' | 'select' | 'date' | 'checkbox';
  /** Placeholder text. */
  readonly placeholder?: string;
  /** Options for select widgets. */
  readonly options?: readonly { readonly value: string; readonly label: string }[];
}

/**
 * Composition entry describing one section of a runtime-composed form
 * (Capability F1). Each entry references a widget already in
 * `ComponentRegistry`; the form renderer mounts them in order and aggregates
 * their values into a single submit payload.
 *
 * Conditional rendering: provide *either* `if` (a closed-AST DSL parsed at
 * registration time) *or* `predicate` (a programmatic escape hatch). They are
 * mutually exclusive — passing both is rejected by the `agenticForm` factory.
 *
 * After the factory runs, an entry's `if` string has been compiled into a
 * `predicate`; the renderer only ever calls `predicate?.(ctx)`.
 *
 * @see docs/plans/ediscovery-dynamic-ui-plan.md §9.1 (Capability F1)
 */
export interface CompositionEntry {
  /** ComponentRegistry name for the widget that renders this section. */
  readonly widget: string;
  /** Optional section heading rendered above the widget. */
  readonly section?: string;
  /**
   * Optional declarative condition. Closed-AST DSL — supports `===`, `!==`,
   * `&&`, `||`, dotted property access, parentheses, and string / number /
   * boolean literals. Parsed at `agenticForm` registration time so authoring
   * errors surface before any UI mounts (AC-F1-3).
   *
   * Mutually exclusive with `predicate`.
   */
  readonly if?: string;
  /**
   * Optional programmatic escape hatch for predicates the DSL cannot express.
   * Receives the form context (matter + persona + partial form values) and
   * returns whether the section should render.
   *
   * Mutually exclusive with `if`.
   */
  readonly predicate?: (ctx: Readonly<Record<string, unknown>>) => boolean;
}

/**
 * Schema-driven form the agent can ask the user to fill. Pairs a Zod schema
 * with a submit handler; the `<mvk-form-renderer>` validates input via the
 * `ValidationRegistry` and invokes `submit` on success.
 *
 * Composition mode (Capability F1): when `composition` is set, the form is
 * built at runtime from registered widgets and `fieldsSchema` is a permissive
 * passthrough synthesized by the `agenticForm` factory.
 *
 * Workflow mode (Capability F3 — provisional, see r3 plan §9.3.3): when
 * `workflow` is set, the entry represents a multi-step wizard. The
 * `<mvk-workflow-renderer>` mounts one step's widget at a time and walks
 * the step graph via Back / Next controls. `submit` is unused in workflow
 * mode; terminal completion runs `workflow.onComplete` instead.
 */
export interface FormDef<TValues = unknown> extends RegistryEntry {
  /** Human-readable description. */
  readonly description: string;
  /** Zod schema for the entire form's values. */
  readonly fieldsSchema: ZodTypeAny;
  /** Optional per-field UI hints, keyed by field name. */
  readonly ui?: Readonly<Record<string, FormFieldUi>>;
  /** Async submit handler invoked when validation passes. */
  readonly submit: (values: TValues) => Promise<void>;
  /**
   * Optional ordered list of widget-backed sections (Capability F1). When
   * present, the renderer mounts each entry's widget in order, evaluates its
   * `predicate` against the form context, and aggregates values across
   * sections at submit time.
   *
   * `if` strings are pre-compiled into `predicate` by the factory; entries
   * stored on `FormDef.composition` therefore have at most a `predicate`,
   * never a remaining `if` string.
   */
  readonly composition?: readonly CompositionEntry[];
  /**
   * Optional workflow definition (Capability F3 — provisional). Mutually
   * exclusive with `composition` — workflow forms render one step's widget
   * at a time via `<mvk-workflow-renderer>`, not all sections at once.
   */
  readonly workflow?: WorkflowDef;
}

/**
 * One step in a workflow (Capability F3 — provisional, r3 plan §9.3).
 *
 * Each step references a widget already in `ComponentRegistry`; the
 * workflow renderer mounts it and provides the step's `id` as the
 * `COMPOSITION_SLOT` so the widget reads/writes through the renderer-
 * scoped `CompositionStore` under that key. State persists across step
 * transitions (and across Back navigation) for free.
 *
 * The `next` field drives transitions:
 *   - `string` → unconditional advance to the named step
 *   - `null`   → terminal step; Next runs `WorkflowDef.onComplete`
 *   - function → branch on the workflow's aggregated state (e.g. jump
 *                to `'matter-setup'` when zero custodians selected)
 */
export interface WorkflowStep {
  /** Unique step id within this workflow. */
  readonly id: string;
  /** ComponentRegistry name for the widget rendered at this step. */
  readonly widget: string;
  /** Optional heading rendered above the widget + in the breadcrumb. */
  readonly section?: string;
  /** Transition target — `null` is terminal; a function branches on state. */
  readonly next:
    | string
    | null
    | ((state: Readonly<Record<string, unknown>>) => string | null);
}

/**
 * Context passed to {@link WorkflowDef.onComplete}. Empty in v1; reserved
 * so future expansion (tool dispatch, agent thread metadata) is non-breaking.
 */
export interface WorkflowCtx {
  /** Reserved for future expansion — currently empty. */
  readonly threadId?: string;
}

/**
 * Workflow definition (Capability F3). Carried on `FormDef.workflow` until
 * ARB ratifies promotion to a top-level `WorkflowRegistry` (R-F3-A).
 *
 * @example
 * ```ts
 * agenticWorkflow({
 *   name: 'placeLegalHold',
 *   description: 'Guided wizard to draft, scope, and send a hold notice.',
 *   steps: [
 *     { id: 'scope',       widget: 'keyword-chip-picker',   next: 'custodians' },
 *     { id: 'custodians',  widget: 'custodian-multi-select',
 *       next: (s) => (s['custodians'] as string[]).length === 0 ? 'matter-setup' : 'date-range' },
 *     { id: 'date-range',  widget: 'date-range-picker',     next: 'preview' },
 *     { id: 'preview',     widget: 'hold-notice-preview',   next: null },
 *   ],
 *   onComplete: async (state, ctx) => placeLegalHoldTool(state),
 * });
 * ```
 */
export interface WorkflowDef {
  /** Ordered list of steps. The first step is the starting point. */
  readonly steps: readonly WorkflowStep[];
  /**
   * Async handler invoked when the user clicks Next on a terminal step
   * (`step.next === null`). Receives the aggregated state from the
   * renderer-scoped `CompositionStore` keyed by step id.
   */
  readonly onComplete: (
    state: Readonly<Record<string, unknown>>,
    ctx: WorkflowCtx,
  ) => Promise<unknown>;
}

// ─── Capability F5 — long-running operations (LRO) ──────────────────────────

/**
 * Lifecycle status of an `Operation` (Capability F5 — r3 plan §9.5).
 *
 *   - `started`  — `startOperation` called; no progress yet.
 *   - `progress` — at least one `reportProgress` call has landed.
 *   - `finished` — terminal-success.
 *   - `failed`   — terminal-error.
 */
export type OperationStatus = 'started' | 'progress' | 'finished' | 'failed';

/** Progress update an LRO tool emits via `ToolContext.reportProgress`. */
export interface OperationProgress {
  /** 0–100 — caller's responsibility to keep monotonic. */
  readonly pct: number;
  /** Optional human-readable phase ("scoring batch 23 / 100"). */
  readonly phase?: string;
  /** Optional partial result (e.g., counts so far). UI may surface. */
  readonly partialResult?: unknown;
}

/** Terminal-failure shape mirrored on `Operation.error`. */
export interface OperationError {
  readonly code: string;
  readonly message: string;
}

/**
 * Metadata at LRO start. The tool calls
 * `ctx.startOperation({ description, estDurationMs? })` and gets back an
 * `opId` it forwards into background work; subsequent
 * `reportProgress(opId, ...)` / `completeOperation(opId, ...)` calls drive
 * the lifecycle.
 */
export interface OperationStartMeta {
  /** Human-readable description shown in the progress widget. */
  readonly description: string;
  /** Optional estimated duration for ETA rendering. */
  readonly estDurationMs?: number;
  /** The tool that initiated the operation. Auto-populated by ToolContext. */
  readonly toolName?: string;
}

/**
 * Persisted LRO record (Capability F5). One per call to
 * `ctx.startOperation` from a `longRunning: true` tool. The chat shell's
 * `<mvk-operation-progress>` widget subscribes via `OperationRegistry`
 * for live updates; the `/operations` route lists all in-flight + recent.
 *
 * Audit posture: every transition appends to the existing tamper-evident
 * chain under the new `operation-{started,progress,finished,failed}`
 * actions (r3 plan §7.8).
 */
export interface Operation {
  readonly opId: string;
  readonly toolName: string;
  readonly description: string;
  readonly status: OperationStatus;
  /** ISO timestamp when `startOperation` was called. */
  readonly startedAt: string;
  readonly estDurationMs?: number;
  /** Continuation handle for cross-session reattach (AC-F5-2). */
  readonly threadId?: string;
  readonly runId?: string;
  readonly toolCallId?: string;
  // ── Progress state ────────────────────────────────────────────
  readonly pct?: number;
  readonly phase?: string;
  readonly partialResult?: unknown;
  // ── Terminal state ────────────────────────────────────────────
  readonly finishedAt?: string;
  readonly durationMs?: number;
  readonly result?: unknown;
  readonly error?: OperationError;
}

// ─── Capability F4 — approval registry (HITL on tool calls) ─────────────────

/**
 * Status of an `Approval` record (Capability F4). Drives the chat-shell
 * intercept loop and the queue UI:
 *
 *   - `pending`  — captured by the chat-shell intercept, awaiting decision
 *   - `approved` — reviewer signed off; the gated tool either ran already
 *                  (sidecar execution) or is about to run
 *   - `rejected` — reviewer declined; the gated tool MUST NOT run
 */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

/**
 * Persisted approval record (Capability F4). One per intercepted tool call
 * that needed HITL. Keyed by `id` (host-generated). Persisted via
 * `PersistenceRegistry` so the queue survives session boundaries — a
 * paralegal triggers an export, lead counsel approves it tomorrow.
 *
 * Audit posture: every transition appends to the existing tamper-evident
 * chain (Phase 5) under the `tool-approved` / `tool-rejected` event kinds.
 */
export interface Approval {
  /** Unique id for this approval record. */
  readonly id: string;
  /** Tool name the approval gates. Matches `ToolDef.name`. */
  readonly toolName: string;
  /** The original args the requester wanted to invoke. Validated frozen copy. */
  readonly args: unknown;
  /** Persona that originated the request. */
  readonly requesterPersona: string;
  /** Current status. */
  readonly status: ApprovalStatus;
  /** ISO timestamp when the approval was queued. */
  readonly createdAt: string;
  /** Persona that decided (only set after status leaves `pending`). */
  readonly approverPersona?: string;
  /** Optional reviewer comment captured on Reject. */
  readonly comment?: string;
  /** ISO timestamp when the decision was made. */
  readonly decidedAt?: string;
  /** Sign-off prompt rendered to the reviewer. */
  readonly signoffMessage: string;
  /** Conversation/run continuation handle for resume (per r3 plan §9.4.3). */
  readonly continuationHandle?: ApprovalContinuationHandle;
}

/**
 * Continuation handle — enough state to resume the original chat thread
 * when the approval lands (r3 plan §9.4.3). v1 records only the
 * thread/turn/tool-call ids; production deployments may carry additional
 * persistence keys (e.g. backend-specific resume tokens).
 */
export interface ApprovalContinuationHandle {
  readonly threadId: string;
  readonly runId: string;
  readonly toolCallId: string;
}

/**
 * Approval policy registered for a specific tool name (Capability F4).
 *
 * The chat-shell intercept consults the matching policy before executing
 * the tool. When `required(args, ctx)` returns `true`, the tool is
 * **not executed**; instead an `Approval{pending}` record is persisted
 * and a synthetic result is returned to the LLM so the agent can inform
 * the user that approval is queued.
 *
 * Mutual-exclusion with `setScopePolicy`: scope policy decides whether
 * a persona can SEE a tool; approval policy decides whether they can
 * INVOKE it without an authorising signature. Both apply.
 */
export interface ApprovalPolicy {
  /** Tool name this policy gates. Matches `ToolDef.name`. */
  readonly tool: string;
  /**
   * Predicate that returns `true` when this invocation needs HITL.
   * Receives the parsed tool args and the running tool context (persona,
   * threadId, etc.). Pure — must not have side effects.
   */
  readonly required: (
    args: unknown,
    ctx: ApprovalDecisionContext,
  ) => boolean;
  /**
   * Roles authorised to approve. The queue UI filters per active
   * persona; the intercept loop revalidates at decision time.
   */
  readonly approverRoles: readonly string[];
  /**
   * Name of a `ComponentRegistry` widget rendering the diff for the
   * reviewer (e.g. a structured before/after view of a production set).
   * The reviewer sees the literal arg payload that will execute on
   * approve — not an LLM-generated summary.
   */
  readonly diffRenderer: string;
  /** Sign-off prompt rendered above the approve/reject buttons. */
  readonly signoffMessage: (args: unknown) => string;
  /**
   * Optional SLA timeout in minutes. When set, the queue UI surfaces
   * an overdue badge after the threshold and (host-deployment-specific)
   * may escalate. Out of scope for v1; reserved for future expansion.
   */
  readonly slaMinutes?: number;
  /**
   * Low-friction record-keeping mode. When `true`, the policy auto-
   * approves with an audit note rather than blocking on a discretionary
   * decision. Use sparingly; defeats the HITL purpose if applied broadly.
   */
  readonly autoApproveAfterAuditNote?: boolean;
}

/**
 * Context passed to `ApprovalPolicy.required(...)`. Mirrors `ToolContext`
 * but adds the active persona so policies can short-circuit on role.
 */
export interface ApprovalDecisionContext {
  readonly persona: string;
  readonly threadId: string;
  readonly runId: string;
  readonly toolCallId: string;
}

/**
 * Registry entry shape for {@link ApprovalPolicy}. Stored in
 * `ApprovalRegistry` keyed by `tool` (which is also `name` for
 * RegistryBase indexing).
 */
export interface ApprovalDef extends RegistryEntry, ApprovalPolicy {
  /* `name === tool` for registry indexing. */
}

// ─── Cross-cutting / extension-seam registries (M5) ──────────────────────────

/** Transport kind for a data source. Used for tooling/instrumentation. */
export type DataSourceKind = 'rest' | 'graphql' | 'sse' | 'http';

/**
 * Pluggable data source. Tools call `inject(DataSourceRegistry).get(name).adapter(query)`
 * instead of hard-coding fetch URLs — enables stubbing in tests, per-env
 * routing, and MFE-aware overrides.
 */
export interface DataSourceDef extends RegistryEntry {
  /** Transport kind. */
  readonly kind: DataSourceKind;
  /** Returns whatever the source emits — Observable for streams, Promise for one-shots. */
  readonly adapter: (query: unknown) => unknown;
}

/** Persistence storage shape. */
export type PersistenceKind = 'kv' | 'json' | 'binary';

/**
 * Pluggable storage adapter (localStorage, sessionStorage, Dexie, server-side, etc.).
 * Used by the chat shell for transcript history, draft form values, and the
 * active backend selection.
 */
export interface PersistenceDef extends RegistryEntry {
  /** Storage shape. */
  readonly kind: PersistenceKind;
  /** Read a value by key. Returns undefined if not present. */
  readonly read: (key: string) => Promise<unknown | undefined>;
  /** Write a value at the given key. */
  readonly write: (key: string, value: unknown) => Promise<void>;
  /** Delete a single key. */
  readonly remove: (key: string) => Promise<void>;
  /** Clear the entire store. */
  readonly clear: () => Promise<void>;
}

/**
 * A layout component the agent can choose by name. Lets the agent emit
 * `widget-render` events with a layout name + per-slot widgets, instead of
 * a single component — for richer generative UIs (split panes, dashboards).
 *
 * Two flavours, distinguished by which optional field is populated:
 *
 *  - **Component-based** — `component: Type<unknown>` is set. The layout
 *    is a single Angular component that projects per-slot content via
 *    `ng-content[slot]` (the original v1 shape).
 *
 *  - **Slot-map** — `slotMap?` is set. The layout is a richer
 *    `SlotMap` payload (see [`layout/types.ts`](../layout/types.ts) /
 *    [ADR-043 D1](../../../../docs/adr/0043-layout-registry-promotion.md))
 *    that `<mvk-workspace-layout>` consumes directly. This is the shape
 *    the agent emits via `LayoutRenderEvent` and the shape user-saved
 *    layouts use. Both flavours coexist on the same registry — adopters
 *    pick whichever they need.
 *
 * Versioning mirrors `DashboardDef`: edits to a saved layout create
 * `version: 'vN'` with `parentVersion: 'vN-1'`, so the audit chain
 * captures the edit history.
 */
export interface LayoutDef extends RegistryEntry {
  /** Human-readable description. */
  readonly description: string;
  /** Named slots the layout exposes (e.g., 'left', 'right', 'main'). */
  readonly slots: readonly string[];
  /** Layout component; expected to project per-slot content via ng-content[slot]. */
  readonly component: Type<unknown>;
  /**
   * Optional slot map — the richer shape `<mvk-workspace-layout>`
   * consumes when an entry represents an agent-emitted or user-saved
   * slot-based composition (ADR-043 D1).
   *
   * Typed as `unknown` here to avoid pulling `SlotMap` from
   * `layout/types.ts` into the registry-defs base module (which has no
   * other layout-types dependency). Consumers cast back to `SlotMap`.
   */
  readonly slotMap?: unknown;
  /** Version string; edits create new versions linked via `parentVersion`. */
  readonly version?: string;
  /** Previous version's `version` — chains the edit history. */
  readonly parentVersion?: string;
}

/** Schema vocabulary tag. */
export type SchemaShape = 'zod' | 'json-schema' | 'openapi';

/**
 * One-way schema converter. Lets a single OpenAPI spec / Zod schema produce
 * tool definitions, forms, and validators from one source.
 */
export interface SchemaTransformerDef extends RegistryEntry {
  /** Source shape. */
  readonly from: SchemaShape;
  /** Target shape. */
  readonly to: SchemaShape;
  /** Pure transform; throws on shapes it can't convert. */
  readonly transform: (input: unknown) => unknown;
}

// ── TriggerRegistry (ADR-045) ───────────────────────────────────────

/**
 * What kind of pattern the `TriggerDef.spec` describes.
 *
 * - `cron` — time-based; `spec.expression` evaluated against now()
 * - `webhook` — HTTP-pushed; the server-side runner exposes a path
 * - `queue` — internal event-bus driven (BullMQ / NATS / etc.)
 *
 * The browser-side runner [(ADR-045 D3)](../../../../docs/adr/0045-trigger-registry.md#d3--browser-side-runner-via-providetriggerrunner-kinds-cron-)
 * supports `cron` only. `webhook` and `queue` are deferred to the
 * server-side runner (ADR-045 D6 / future ADR-046).
 */
export type TriggerKind = 'cron' | 'webhook' | 'queue';

export type TriggerSpec =
  | { readonly kind: 'cron'; readonly expression: string; readonly timezone?: string }
  | { readonly kind: 'webhook'; readonly path: string; readonly secret?: string }
  | { readonly kind: 'queue'; readonly topic: string };

/** Where the trigger dispatches when it fires. */
export type TriggerTarget =
  | { readonly kind: 'tool'; readonly tool: string; readonly args?: unknown }
  | { readonly kind: 'action'; readonly action: string; readonly payload?: unknown }
  | { readonly kind: 'notification'; readonly compose: (firing: TriggerFiringContext) => NotificationDraft };

/**
 * Context passed to a notification target's `compose()` function. Carries
 * the firing identity so the notification can be persona-attributed and
 * audit-chained.
 */
export interface TriggerFiringContext {
  readonly triggerId: string;
  readonly firedAt: string;          // ISO timestamp
  readonly firedBy: string;          // 'system' | persona id
  readonly correlationId: string;    // unique per fire — links to audit chain
}

/**
 * Notification CTA — what the user does when they click an action
 * button on the rendered notification. Modelled on `IntentTarget`
 * (`tool | action | route`) instead of `TriggerTarget` because a
 * notification can deep-link to a route (which a trigger itself
 * cannot — triggers fire, they don't navigate).
 */
export type NotificationCta =
  | { readonly kind: 'tool'; readonly tool: string; readonly args?: unknown }
  | { readonly kind: 'action'; readonly action: string; readonly payload?: unknown }
  | { readonly kind: 'route'; readonly target: string };

/** A draft notification a trigger emits; the host renders it in the Inbox / tray. */
export interface NotificationDraft {
  readonly title: string;
  readonly body?: string;
  readonly severity?: 'info' | 'warning' | 'error';
  /** Optional action button payload — e.g. `{kind: 'route', target: '/holds/H-1'}`. */
  readonly cta?: NotificationCta;
}

/**
 * Registered trigger — fires its `target` on the `spec` cadence.
 *
 * Persona attribution via `runAs` (ADR-045 D5). Without it, the trigger
 * falls back to the locked-down `'trigger:default'` persona that hosts
 * must explicitly map. Loud-safe default.
 *
 * Disabled at the registry level via `lifecycle: 'disabled'` (from
 * RegistryEntry's governance hooks, ADR-014). Disabled triggers stay
 * registered (visible in the ops console) but never fire.
 *
 * @see [ADR-045](../../../../docs/adr/0045-trigger-registry.md)
 */
export interface TriggerDef extends RegistryEntry {
  /** Human-readable description; surfaces in the ops console. */
  readonly description: string;
  /** Kind discriminator — matches `spec.kind` for type-narrowing. */
  readonly kind: TriggerKind;
  /** Firing pattern. */
  readonly spec: TriggerSpec;
  /** What happens when the trigger fires. */
  readonly target: TriggerTarget;
  /** Optional persona id for the fire's scope + audit attribution. */
  readonly runAs?: string;
}

// ── DashboardRegistry (ADR-044) ─────────────────────────────────────

/**
 * How a tile gets its value — one of three.
 *
 * - `tool` — re-invokes a `ToolRegistry` tool on refresh. Chain-hashed
 *   each call. Persona scope applies via `ToolRegistry.get()`.
 * - `data` — re-queries a `DataSourceRegistry` source on refresh.
 *   Cheaper than tools (no audit-chain entry per re-query); use for
 *   plain reads where audit isn't load-bearing.
 * - `static` — renders props verbatim. No refresh. Use for headers,
 *   blurbs, non-data tiles in a layout.
 *
 * @see [ADR-044 D3](../../../../docs/adr/0044-dashboard-registry.md#d3--tiledef-invocation-is-tool--data--static--one-of-three)
 */
export type TileInvocation =
  | { readonly kind: 'tool'; readonly tool: string; readonly args: Readonly<Record<string, unknown>> }
  | { readonly kind: 'data'; readonly source: string; readonly query: Readonly<Record<string, unknown>> }
  | { readonly kind: 'static'; readonly props: unknown };

/** When a tile should refresh its value. */
export type TileRefreshTrigger = 'load' | 'interval' | 'event' | 'manual';

/**
 * Optional drill-down target for a tile. Click on the tile body
 * activates this — host wires the actual navigation / longer-form
 * tool invocation.
 */
export interface TileDrilldown {
  readonly tool?: string;
  readonly route?: string;
}

/** A single tile in a dashboard. */
export interface TileDef {
  readonly id: string;
  /** Slot name in the parent dashboard's `LayoutDef`. */
  readonly slot: string;
  readonly title: string;
  /** ComponentRegistry name — resolved + mounted via `*ngComponentOutlet`. */
  readonly component: string;
  /** How the tile gets its value. */
  readonly invocation: TileInvocation;
  /** Optional refresh strategy; defaults to `'load'`. */
  readonly refreshOn?: TileRefreshTrigger;
  /** Optional drill-down target activated on tile body click. */
  readonly drilldown?: TileDrilldown;
  /** Hint: when true, the tile surfaces an "explain this" affordance. */
  readonly explainable?: boolean;
  /** Optional cache TTL — re-uses prior value for `cacheTtlMs` after a tool call. */
  readonly cacheTtlMs?: number;
}

/**
 * A global filter applied to every `kind: 'tool'` tile's args at
 * invocation time. Threads cross-matter / cross-tenant / time-range
 * parameters through without per-tile boilerplate.
 */
export interface FilterDef {
  /** Stable key for re-binding from the dashboard chrome. */
  readonly id: string;
  /** Argument key the filter writes into each tile's invocation args. */
  readonly argKey: string;
  /** Current value — the dashboard chrome owns mutation. */
  readonly value: unknown;
  /** Human-readable label for the filter chip. */
  readonly label: string;
}

/**
 * A first-class dashboard. References a `LayoutDef` (from ADR-043),
 * pins tiles into the layout's slots, and optionally binds an
 * ADR-045 `TriggerDef` for cron-driven refresh.
 *
 * @see [ADR-044](../../../../docs/adr/0044-dashboard-registry.md)
 */
export interface DashboardDef extends RegistryEntry {
  readonly title: string;
  readonly description?: string;
  /** Inline `LayoutDef` or a string name resolved via `LayoutRegistry`. */
  readonly layout: LayoutDef | string;
  /** Ordered tiles; multiple tiles can share a slot (the layout decides). */
  readonly tiles: readonly TileDef[];
  /** Global params threaded into every `kind: 'tool'` tile's args. */
  readonly filters?: readonly FilterDef[];
  /** Inline `TriggerDef` or a string name from `TriggerRegistry`. */
  readonly schedule?: TriggerDef | string;
  /** Version string; edits create new versions linked via `parentVersion`. */
  readonly version?: string;
  /** Previous version's `version` value — chains the edit history. */
  readonly parentVersion?: string;
}

// ── PlaybookRegistry (P5 of post-chat-surfaces plan) ─────────────────

/**
 * One step in a playbook — a named tool invocation with deterministic
 * args. The runtime fires steps in declared order; each step's tool
 * call inherits the playbook's audit attribution.
 */
export interface PlaybookStep {
  readonly id: string;
  /** Human-readable title surfaced in the runner UI. */
  readonly title: string;
  /** Optional short description for the runner UI. */
  readonly description?: string;
  /** `ToolRegistry` name to invoke. */
  readonly tool: string;
  /** Args passed verbatim to the tool's handler. */
  readonly args: Readonly<Record<string, unknown>>;
  /**
   * When true, a failure in this step does NOT abort the playbook —
   * the runner records the failure and continues. Default: false.
   */
  readonly continueOnError?: boolean;
  /**
   * When true, the runner halts before invoking and surfaces a
   * confirm-or-skip affordance. Used for irreversible operations.
   */
  readonly requiresApproval?: boolean;
}

/**
 * A versioned, persona-scoped sequence of tool calls — the *"Initial
 * Privilege Pass v3"* shape. Joins `DashboardDef` as a first-class
 * artefact in the catalog; same `removeBySource` symmetry for MFE-
 * contributed playbooks; same persona scope; same audit attribution.
 *
 * @see [post-chat-surfaces-plan §5 / Workflow G](../../../../docs/plans/post-chat-surfaces-plan.md#4-complex-workflows-worth-modelling)
 */
export interface PlaybookDef extends RegistryEntry {
  readonly title: string;
  readonly description?: string;
  /** Ordered steps the runner fires sequentially. */
  readonly steps: readonly PlaybookStep[];
  /** Version string; edits create new versions linked via `parentVersion`. */
  readonly version?: string;
  /** Previous version's `version` — chains the edit history. */
  readonly parentVersion?: string;
}

/** Step states the runner emits as it fires the playbook. */
export type PlaybookStepStatus =
  | 'pending'
  | 'awaiting-approval'
  | 'running'
  | 'success'
  | 'failed'
  | 'skipped'
  | 'cancelled';

/** Live state per step. Hosts read this via `RunningPlaybook.state`. */
export interface PlaybookStepState {
  readonly stepId: string;
  readonly status: PlaybookStepStatus;
  /** Captured tool result on success. */
  readonly result?: unknown;
  /** Captured error message on failure. */
  readonly error?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

/** Overall run status — derived from the step states. */
export type PlaybookRunStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled';

/** Snapshot of a running playbook. */
export interface PlaybookRun {
  readonly playbookName: string;
  readonly version?: string;
  readonly startedAt: string;
  readonly steps: readonly PlaybookStepState[];
  readonly overall: PlaybookRunStatus;
}

// ─── AEP Seam B — new capability registries ─────────────────────────────────
//
// Each of the following is a registrable capability with its own `*Def`
// extending `RegistryEntry`, hosted by a trivial `RegistryBase<TDef>` subclass.
// They fill conceptual gaps that had no home before (no existing registry owns
// prompts, skills, knowledge sources, memory providers, standalone workflows,
// or navigation). All are additive and inherit `requires`/`produces` (Seam A)
// so the Experience Planner can traverse them.

/**
 * A versioned, reusable prompt template. Prompts were inline strings before;
 * `PromptRegistry` gives them a catalog with lifecycle + scoping so a
 * "Prompt Studio" can author and approve them.
 */
export interface PromptDef extends RegistryEntry {
  /** The prompt text. May contain `{{variable}}` placeholders. */
  readonly template: string;
  /** Human-facing description for catalog listing. */
  readonly description?: string;
  /** Names of `{{variables}}` the template expects. */
  readonly variables?: readonly string[];
  /** Optional target-model hint (e.g. 'claude-opus-5'). */
  readonly model?: string;
  /** Semver; reuse the template version-chain convention. */
  readonly version?: string;
}

/**
 * A named, reusable bundle of tools + guiding prompt the agent can select as a
 * unit. Distinct from a `PlaybookDef` (a deterministic, author-ordered
 * sequence) — a skill is agent-selectable and order-free.
 */
export interface SkillDef extends RegistryEntry {
  readonly description: string;
  /** `ToolRegistry` names this skill draws on. */
  readonly tools: readonly string[];
  /** Optional `PromptRegistry` name that guides the skill. */
  readonly prompt?: string;
  readonly version?: string;
}

/**
 * Metadata for a knowledge source (RAG corpus, document store, SQL/graph/API).
 * Metadata only — retrieval stays adapter-side (no OpenSearch etc. in the
 * runtime bundle; honors the runtime non-goals).
 */
export interface KnowledgeDef extends RegistryEntry {
  readonly description?: string;
  /** Shape of the source. */
  readonly kind: 'vector' | 'document' | 'sql' | 'graph' | 'api' | (string & {});
  /** Adapter / `DataSourceRegistry` name that performs retrieval. */
  readonly connector?: string;
  /** Optional locator for the source (index name, URL, table). */
  readonly uri?: string;
}

/**
 * Metadata for a memory provider (aligns to ROADMAP Tier 1.4 —
 * "Long-term memory registry"). Metadata only; the provider adapter does the
 * storage/retrieval work.
 */
export interface MemoryDef extends RegistryEntry {
  readonly description?: string;
  /** Memory class. */
  readonly kind: 'short-term' | 'long-term' | 'episodic' | 'semantic' | (string & {});
  /** Isolation scope the memory is keyed by. */
  readonly scope?: 'user' | 'thread' | 'tenant' | 'global' | (string & {});
  /** Adapter / `PersistenceRegistry` name backing this memory. */
  readonly provider?: string;
}

/**
 * Promotes a {@link WorkflowDef} step graph to a first-class, registered,
 * versioned, discoverable capability. Previously workflows only existed
 * embedded in a synthesized `FormDef.workflow`; this makes them addressable.
 */
export interface WorkflowCapabilityDef extends RegistryEntry {
  readonly description?: string;
  /** The step graph this capability runs. */
  readonly workflow: WorkflowDef;
  readonly version?: string;
}

/**
 * A navigation entry an app or MFE contributes to the shell, so navigation
 * becomes capability-driven (contributable + scopable + federation-symmetric)
 * instead of app-hardcoded.
 */
export interface NavigationDef extends RegistryEntry {
  /** Label shown in the nav. */
  readonly title: string;
  /** Router path or external URL. */
  readonly route: string;
  /** Optional icon name/token. */
  readonly icon?: string;
  /** Sort key within the parent group (ascending; unset sorts last). */
  readonly order?: number;
  /** Parent `NavigationDef` name for nesting; unset = top-level. */
  readonly parent?: string;
  /** When true, `route` is an external URL. */
  readonly external?: boolean;
}
