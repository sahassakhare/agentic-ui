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
 * Schema-driven form the agent can ask the user to fill. Pairs a Zod schema
 * with a submit handler; the `<mvk-form-renderer>` validates input via the
 * `ValidationRegistry` and invokes `submit` on success.
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
