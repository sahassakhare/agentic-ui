import { z } from 'zod';
import type { ToolDef } from '@infra-tools/agentic-ui';

/**
 * Composer tools that let the LLM actually pick the layout structure — not
 * the tool handler. Each tool's `schema` is the Zod shape the LLM must
 * populate; the handler just validates and wraps the result so the host
 * mounts the matching lib surface (<mvk-dashboard-canvas>,
 * <mvk-workspace-layout>, or an agent-driven shell).
 *
 * Step-up over the previous version:
 *
 *   A — `composeAccountDashboard` / `composeAccountWorkspace` now require
 *       the layout structure as Zod-typed *arguments*. The LLM picks slots,
 *       tiles, args.
 *
 *   B — `composePageLayout(routeId, slots)` builds the main column for a
 *       single page. The host swaps it into the active route's main slot.
 *
 *   C — `composeShell` lets the agent emit the entire shell — brand,
 *       sidebar nav items, and the main slots layout. The host renders it
 *       through `<app-agent-shell-wrapper>`.
 *
 *   D — `composeWorkspaceFromLayoutChannel` mimics an AG-UI `layout-render`
 *       event: the result's `layoutEvent` field is what a backend would
 *       have pushed via `chat.activeLayout()`. The host listens for it and
 *       surfaces it in the layout-channel viewer.
 */

// ── Shared schemas ────────────────────────────────────────────────────────

const AVAILABLE_TOOLS = [
  'bookFlight',
  'checkPoints',
  'openTicket',
  'listUpcomingTrips',
  'getLoyaltyAccount',
  'listSupportTickets',
] as const;

const AVAILABLE_COMPONENTS = [
  'flightCard',
  'pointsCard',
  'ticketCard',
  'tripListCard',
  'loyaltyOverviewCard',
  'ticketListCard',
] as const;

const tileInvocationSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('tool'),
    tool: z.enum(AVAILABLE_TOOLS).describe('Tool to invoke for this tile'),
    args: z.record(z.string(), z.unknown()).default({}).describe('Args object passed to the tool'),
  }),
  z.object({
    kind: z.literal('static'),
    props: z.record(z.string(), z.unknown()).describe('Static props bound to the component'),
  }),
]);

const layoutDefSchema = z.object({
  name: z.string().describe('Stable name for the layout'),
  description: z.string().describe('Brief layout description'),
  slots: z.array(z.string()).min(1).describe('Ordered slot names'),
  component: z.literal('emptyLayout').describe('Always use "emptyLayout"'),
});

const tileDefSchema = z.object({
  id: z.string().describe('Stable id for the tile'),
  slot: z.string().describe('Slot name (must appear in layout.slots)'),
  title: z.string().describe('Tile title shown in the canvas chrome'),
  component: z.enum(AVAILABLE_COMPONENTS).describe('Component name from ComponentRegistry'),
  invocation: tileInvocationSchema,
  refreshOn: z.enum(['load', 'interval', 'event', 'manual']).default('load').optional(),
});

const dashboardDefSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string().optional(),
  layout: layoutDefSchema,
  tiles: z.array(tileDefSchema).min(1),
});

const slotEntrySchema = z.object({
  component: z.enum(AVAILABLE_COMPONENTS).describe('Component name from ComponentRegistry'),
  inputs: z.record(z.string(), z.unknown()).optional().describe('Props bound as Angular inputs'),
  size: z.object({
    default: z.string().optional().describe("CSS flex-basis e.g. '60%'"),
    min: z.string().optional(),
    max: z.string().optional(),
  }).optional(),
});

const slotMapSchema = z.record(z.string(), slotEntrySchema);

// ── A — Real LLM-driven L2 / L3 ───────────────────────────────────────────

export const composeAccountDashboardTool: ToolDef = {
  name: 'composeAccountDashboard',
  description:
    'Compose a multi-tile account dashboard. The caller must emit the full `dashboard` object: name, title, ' +
    'a layout with slot names and `component: "emptyLayout"`, plus tiles[] each with id, slot, title, ' +
    'a component from the registry, and a kind:"tool" invocation. Returns a wrapper rendered through ' +
    '<mvk-dashboard-canvas>.',
  schema: z.object({ dashboard: dashboardDefSchema }),
  handler: async (args) => {
    const { dashboard } = args as { dashboard: z.infer<typeof dashboardDefSchema> };
    return { dashboard, components: [{ name: 'dashboardWrapper', props: { dashboard } }] };
  },
};

export const composeAccountWorkspaceTool: ToolDef = {
  name: 'composeAccountWorkspace',
  description:
    'Compose a workspace layout. The caller must emit a `slots` map: each slot name → { component, inputs, size }. ' +
    'Returns a wrapper rendered through <mvk-workspace-layout>.',
  schema: z.object({ slots: slotMapSchema }),
  handler: async (args) => {
    const { slots } = args as { slots: z.infer<typeof slotMapSchema> };
    return { slots, components: [{ name: 'workspaceWrapper', props: { slots } }] };
  },
};

// ── B — Per-page agent composition ────────────────────────────────────────

export const composePageLayoutTool: ToolDef = {
  name: 'composePageLayout',
  description:
    'Compose the main content for a single route page. Returns a SlotMap mounted through ' +
    '<mvk-workspace-layout>. Use when the user asks to "build/compose this page" or to ' +
    '"redesign" a route.',
  schema: z.object({
    routeId: z.enum(['trips', 'loyalty', 'support']).describe('Route the layout is for'),
    slots: slotMapSchema,
  }),
  handler: async (args) => {
    const { routeId, slots } = args as { routeId: string; slots: z.infer<typeof slotMapSchema> };
    return { routeId, slots, components: [{ name: 'workspaceWrapper', props: { slots } }] };
  },
};

// ── C — Agent-driven whole shell ──────────────────────────────────────────

const navItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  icon: z.string().optional().describe('One-character icon hint'),
});

const shellDefSchema = z.object({
  brand: z.string().describe('Brand name shown in the topbar'),
  tagline: z.string().optional().describe('Short tagline beneath the brand'),
  navItems: z.array(navItemSchema).min(1).describe('Sidebar nav items'),
  mainSlots: slotMapSchema.describe('Workspace slots for the main column'),
});

export const composeShellTool: ToolDef = {
  name: 'composeShell',
  description:
    'Compose the entire app shell — brand, optional tagline, sidebar nav items, and the main slots ' +
    'layout. Returns a payload rendered through <app-agent-shell-wrapper>. Use this when the user ' +
    'asks to "rebuild the app", "generate the shell", or "design my whole UI".',
  schema: shellDefSchema,
  handler: async (args) => {
    const shell = args as z.infer<typeof shellDefSchema>;
    return { shell, components: [{ name: 'agentShellWrapper', props: { shell } }] };
  },
};

// ── D — `layout-render`-style channel ─────────────────────────────────────

const layoutEventSchema = z.object({
  layoutName: z.string().describe('Name of the layout being rendered'),
  slots: slotMapSchema.describe('The SlotMap the host should mount'),
  reason: z.string().optional().describe('Why this layout fires (telemetry / debug)'),
});

export const composeViaLayoutChannelTool: ToolDef = {
  name: 'composeViaLayoutChannel',
  description:
    'Emit a layout-render-shaped event. Mirrors the ADR-043 `layout-render` AG-UI event — the agent ' +
    'tells the host "mount this slot map as a layout right now," and a separate host signal ' +
    '(activeLayoutSlots) drives the rendering. Use this when the user asks to "push a layout" or ' +
    '"send a layout-render".',
  schema: z.object({ layoutEvent: layoutEventSchema }),
  handler: async (args) => {
    const { layoutEvent } = args as { layoutEvent: z.infer<typeof layoutEventSchema> };
    // The host listens for `layoutEvent` in the chat's tool-call results and
    // pushes it onto a dedicated signal — separate channel from the
    // generative-UI `components` payload that drives the chat shell.
    return {
      layoutEvent,
      components: [{ name: 'workspaceWrapper', props: { slots: layoutEvent.slots } }],
    };
  },
};

export const composerTools: readonly ToolDef[] = [
  composeAccountDashboardTool,
  composeAccountWorkspaceTool,
  composePageLayoutTool,
  composeShellTool,
  composeViaLayoutChannelTool,
];
