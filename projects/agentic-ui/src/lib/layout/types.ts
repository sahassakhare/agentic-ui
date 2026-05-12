/**
 * Layout types for the slot-based workspace primitive ([ADR-043](../../../../docs/adr/0043-layout-registry-promotion.md)).
 *
 * `LayoutDef` itself (the registry entry) lives in `../types/registry-defs.ts`
 * for backwards-compat with the existing `RegistryEntry` machinery. This
 * module adds the *richer* layout vocabulary the agent can emit at runtime:
 *
 * - `ChatShellMode` — the five `<mvk-chat-shell mode="...">` presentations
 *   (ADR-043 D2).
 * - `SlotDef` / `ResponsiveCollapseRule` — slot-based composition
 *   (ADR-043 D1, D6) layered on top of the existing `LayoutDef.slots: string[]`.
 * - `LayoutRenderEvent` — the AG-UI event the agent emits to direct the
 *   screen (ADR-043 D3).
 * - `LayoutPolicy` + `LAYOUT_POLICY` — per-persona shell-mode + density
 *   resolution (ADR-043 D4).
 *
 * All shapes are Zod-validated so a malformed `LAYOUT_RENDER` payload falls
 * back to rail mode + a `console.warn` (same defence-in-depth pattern as
 * the existing `components: [...]` validation).
 */

import { InjectionToken } from '@angular/core';
import { z } from 'zod';

// ───────────────────────────────────────────────────────────────────────────
// ADR-043 D2 — ChatShellMode
// ───────────────────────────────────────────────────────────────────────────

/**
 * The five presentations the chat shell can render in, plus `hidden` for
 * routes where chat is the wrong primitive (Audit, query-bar surfaces) and
 * `assist-panel` for the Cursor-style structured-affordance panel that
 * arrives with the `<mvk-assist-panel>` component in P1.
 *
 * @see [ADR-043 D2](../../../../docs/adr/0043-layout-registry-promotion.md#d2--mvk-chat-shell-adds-a-mode-prop-defaulting-to-rail)
 */
export type ChatShellMode =
  | 'rail'          // default — persistent ~360px right rail (back-compat)
  | 'pill'          // floating corner pill, expands on click
  | 'overlay'       // full-screen transient overlay
  | 'docked-bottom' // sticky ~120px bottom strip for dashboards
  | 'assist-panel'  // Cursor-style structured-affordance panel (P1)
  | 'hidden';       // chat is the wrong primitive — Audit, query-bar routes

/** Runtime guard set — used by Zod schemas + tests. */
export const CHAT_SHELL_MODES = [
  'rail',
  'pill',
  'overlay',
  'docked-bottom',
  'assist-panel',
  'hidden',
] as const satisfies readonly ChatShellMode[];

export const chatShellModeSchema = z.enum(CHAT_SHELL_MODES);

// ───────────────────────────────────────────────────────────────────────────
// ADR-043 D1 — SlotDef (slot-based composition)
// ───────────────────────────────────────────────────────────────────────────

/**
 * One slot in a slot-based layout. `component` is a `ComponentRegistry`
 * name — resolved at render time, validated against the component's Zod
 * schema, and mounted via `*ngComponentOutlet`. `open` lets the agent ask
 * for an alternative presentation than inline (modal / drawer / overlay).
 *
 * @see [ADR-043 D1](../../../../docs/adr/0043-layout-registry-promotion.md#d1--layoutdef-extends-to-slot-based-composition)
 */
export interface SlotDef {
  readonly component: string;
  readonly props?: unknown;
  readonly size?: SlotSize;
  readonly pinned?: boolean;
  readonly open?: SlotOpenMode;
}

export interface SlotSize {
  readonly default: string;   // e.g. '60%', '320px'
  readonly min?: string;
  readonly max?: string;
}

export type SlotOpenMode = 'inline' | 'modal' | 'drawer' | 'overlay';

export const slotOpenModeSchema = z.enum(['inline', 'modal', 'drawer', 'overlay']);

export const slotSizeSchema: z.ZodType<SlotSize> = z.object({
  default: z.string(),
  min: z.string().optional(),
  max: z.string().optional(),
});

export const slotDefSchema: z.ZodType<SlotDef> = z.object({
  component: z.string().min(1),
  props: z.unknown().optional(),
  size: slotSizeSchema.optional(),
  pinned: z.boolean().optional(),
  open: slotOpenModeSchema.optional(),
});

// ───────────────────────────────────────────────────────────────────────────
// ADR-043 D6 — ResponsiveCollapseRule
// ───────────────────────────────────────────────────────────────────────────

/**
 * Per-breakpoint declaration of how a layout degrades. The chat shell +
 * workspace-layout component consult these at render time so the agent and
 * the surface agree on how to collapse without scattering CSS media queries.
 *
 * @see [ADR-043 D6](../../../../docs/adr/0043-layout-registry-promotion.md#d6--responsive-collapse-rules-live-in-layoutdef-not-in-css)
 */
export interface ResponsiveCollapseRule {
  /** Apply this rule when `window.innerWidth < belowPx`. */
  readonly belowPx: number;
  /** Slot names that disappear at this breakpoint. */
  readonly collapse: readonly string[];
  /** Slot names that become a drawer (slide-in) at this breakpoint. */
  readonly drawer: readonly string[];
}

export const responsiveCollapseRuleSchema: z.ZodType<ResponsiveCollapseRule> = z.object({
  belowPx: z.number().positive().int(),
  collapse: z.array(z.string()).readonly(),
  drawer: z.array(z.string()).readonly(),
});

// ───────────────────────────────────────────────────────────────────────────
// ADR-043 D1 — slot-based layout definition (in-event shape)
// ───────────────────────────────────────────────────────────────────────────

/**
 * The slot-based companion to the registry's `LayoutDef.slots: string[]`.
 * When the agent emits a `LAYOUT_RENDER` event, this is the payload's
 * `slots` value — a map keyed by slot name. The registry's `LayoutDef`
 * stays the canonical *layout type definition*; this shape carries the
 * *instance content* for one specific render.
 */
export interface SlotMap {
  readonly [slotName: string]: SlotDef;
}

export const slotMapSchema = z.record(z.string(), slotDefSchema);

// ───────────────────────────────────────────────────────────────────────────
// ADR-043 D3 — LayoutRenderEvent (agent-emittable layout)
// ───────────────────────────────────────────────────────────────────────────

/**
 * The AG-UI event the agent emits to request a slot-based layout. Either
 * a `layoutName` (registry lookup) or an inline `slots` map, plus optional
 * shared `data` that slot `props` can reference.
 *
 * @see [ADR-043 D3](../../../../docs/adr/0043-layout-registry-promotion.md#d3--layoutdef-becomes-agent-emittable-via-an-ag-ui-event)
 */
export type LayoutRenderEvent =
  | LayoutRenderByName
  | LayoutRenderAdHoc;

export interface LayoutRenderByName {
  readonly type: 'LAYOUT_RENDER';
  readonly layoutName: string;
  readonly slots: SlotMap;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface LayoutRenderAdHoc {
  readonly type: 'LAYOUT_RENDER';
  readonly layoutName?: undefined;
  readonly slots: SlotMap;
  readonly responsive?: readonly ResponsiveCollapseRule[];
  readonly data?: Readonly<Record<string, unknown>>;
}

export const layoutRenderEventSchema = z.union([
  z.object({
    type: z.literal('LAYOUT_RENDER'),
    layoutName: z.string().min(1),
    slots: slotMapSchema,
    data: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal('LAYOUT_RENDER'),
    layoutName: z.undefined().optional(),
    slots: slotMapSchema,
    responsive: z.array(responsiveCollapseRuleSchema).readonly().optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  }),
]) satisfies z.ZodType<LayoutRenderEvent>;

// ───────────────────────────────────────────────────────────────────────────
// ADR-043 D4 — LayoutPolicy + LAYOUT_POLICY InjectionToken
// ───────────────────────────────────────────────────────────────────────────

/**
 * Per-persona shell-mode + layout-density preferences. Resolved at runtime
 * by `<mvk-chat-shell>` so a junior reviewer and a partner see different
 * *shapes* of the same route, not just different *content*.
 *
 * Apps that don't provide a `LayoutPolicy` get the default behaviour
 * (rail mode, comfortable density). Existing `<mvk-chat-shell />`
 * consumers see no change.
 *
 * @see [ADR-043 D4](../../../../docs/adr/0043-layout-registry-promotion.md#d4--setlayoutpolicypersona-on-registrybase-parallel-to-setscopepolicy)
 */
export interface LayoutPolicy {
  /** Resolve the chat shell's presentation for the given route. */
  readonly shellMode: (route: string) => ChatShellMode;
  /** UI density preference for this persona. */
  readonly density: () => LayoutDensity;
  /** Optional per-route workspace layout name override. */
  readonly workspaceLayout?: (route: string) => string | null;
}

export type LayoutDensity = 'comfortable' | 'compact' | 'dense';

/** Default policy used when no `provideLayoutPolicy` is wired. */
export const DEFAULT_LAYOUT_POLICY: LayoutPolicy = {
  shellMode: () => 'rail',
  density: () => 'comfortable',
};

/**
 * Injection token for the active persona's `LayoutPolicy`. Use
 * `provideLayoutPolicy({...})` from `../platform/provide-layout-policy` to
 * wire one; resolve via `inject(LAYOUT_POLICY)`.
 */
export const LAYOUT_POLICY = new InjectionToken<LayoutPolicy>('LAYOUT_POLICY', {
  providedIn: 'root',
  factory: () => DEFAULT_LAYOUT_POLICY,
});
