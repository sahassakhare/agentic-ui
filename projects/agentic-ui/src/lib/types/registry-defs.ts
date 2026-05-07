import type { Type } from '@angular/core';
import type { ZodTypeAny } from 'zod';
import type { AgenticBackend } from './agentic-backend';

/**
 * Discriminator for where a registry entry came from. Drives MFE-aware
 * teardown via `Registry.removeBySource()` — when a remote unloads, the
 * orchestrator calls `removeBySource('remote:<name>')` once and every
 * registry strips the matching entries in one pass.
 */
export type CapabilitySource = 'host' | `remote:${string}` | `mcp:${string}` | `external:${string}`;

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
 */
export interface LayoutDef extends RegistryEntry {
  /** Human-readable description. */
  readonly description: string;
  /** Named slots the layout exposes (e.g., 'left', 'right', 'main'). */
  readonly slots: readonly string[];
  /** Layout component; expected to project per-slot content via ng-content[slot]. */
  readonly component: Type<unknown>;
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
