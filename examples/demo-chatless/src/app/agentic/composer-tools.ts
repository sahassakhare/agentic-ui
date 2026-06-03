import { z } from 'zod';
import type { ToolDef } from '@infra-tools/agentic-ui';

/**
 * Local-only tools the chatless dashboard registers IN ADDITION TO the
 * shared booking/loyalty/support tools. The agent calls these when the user
 * triggers an "agent-composed view" — the handler returns a registry-shaped
 * description of the UI to render (a `DashboardDef` or a `SlotMap`) wrapped
 * inside the generative-UI `components` field. The corresponding wrapper
 * widget (dashboardWrapper / workspaceWrapper) mounts it through the lib's
 * `<mvk-dashboard-canvas>` / `<mvk-workspace-layout>` surface.
 *
 * Pattern: the LLM picks which tool to call (which surface to compose); the
 * tool handler shapes the layout (which slots, which tiles, which arguments).
 */

// ── L2: agent-driven dashboard (via DashboardRegistry's canvas) ────────────

export const composeAccountDashboardTool: ToolDef = {
  name: 'composeAccountDashboard',
  description:
    'Build a multi-tile dashboard that summarises this account at a glance: ' +
    'an upcoming flight, the loyalty status, and any open support ticket. ' +
    'Returns a DashboardDef the host renders through <mvk-dashboard-canvas>. ' +
    'Use when the user asks to "build a dashboard" or to "show everything in one view".',
  schema: z.object({}),
  handler: async () => {
    // Construct an inline DashboardDef — the agent's "choice of layout" is
    // baked into the tool's selection. Each tile is `kind: 'tool'` so the
    // canvas auto-invokes the underlying handler through ToolRegistry.
    const dashboard = {
      name: 'accountDashboard',
      title: 'Account dashboard',
      description: 'Composed by the agent on your behalf.',
      layout: {
        name: 'accountLayout',
        description: '3-slot grid layout',
        slots: ['flights', 'loyalty', 'support'] as const,
        component: 'emptyLayout',
      },
      tiles: [
        {
          id: 'tile-flight',
          slot: 'flights',
          title: 'Upcoming trip',
          component: 'flightCard',
          invocation: { kind: 'tool' as const, tool: 'bookFlight', args: { from: 'LAX', to: 'JFK', date: '2026-06-15' } },
          refreshOn: 'load' as const,
        },
        {
          id: 'tile-points',
          slot: 'loyalty',
          title: 'Loyalty balance',
          component: 'pointsCard',
          invocation: { kind: 'tool' as const, tool: 'checkPoints', args: {} },
          refreshOn: 'load' as const,
        },
        {
          id: 'tile-ticket',
          slot: 'support',
          title: 'Latest support ticket',
          component: 'ticketCard',
          invocation: {
            kind: 'tool' as const,
            tool: 'openTicket',
            args: { subject: 'Refund delayed', priority: 'high' },
          },
          refreshOn: 'load' as const,
        },
      ],
    };
    return { dashboard, components: [{ name: 'dashboardWrapper', props: { dashboard } }] };
  },
};

// ── L3: agent-driven workspace (via WorkspaceLayoutComponent's SlotMap) ────

export const composeAccountWorkspaceTool: ToolDef = {
  name: 'composeAccountWorkspace',
  description:
    'Build a workspace layout the host renders through <mvk-workspace-layout>. ' +
    'Returns a SlotMap: each slot is a name → { component, inputs, size }. ' +
    'Use when the user asks to "compose my workspace" or to "lay everything out".',
  schema: z.object({}),
  handler: async () => {
    // The agent's choice of workspace = a 2-slot composition: a "main" pane
    // with a flight + ticket stacked, and a "side" pane with the loyalty
    // status. Each slot's `component` is a `ComponentRegistry` name; `inputs`
    // are the props.
    const slots = {
      main: {
        component: 'flightCard',
        inputs: { bookingId: 'BK-AG-PRI', from: 'LAX', to: 'JFK', date: '2026-06-15', status: 'confirmed' },
        size: { default: '60%' },
      },
      side: {
        component: 'pointsCard',
        inputs: { balance: 32500, tier: 'gold' },
        size: { default: '40%' },
      },
    };
    return { slots, components: [{ name: 'workspaceWrapper', props: { slots } }] };
  },
};

export const composerTools: readonly ToolDef[] = [composeAccountDashboardTool, composeAccountWorkspaceTool];
