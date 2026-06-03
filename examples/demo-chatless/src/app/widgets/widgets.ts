import { z } from 'zod';
import { agenticWidget, type ComponentDef } from '@infra-tools/agentic-ui';
import { FlightCardComponent } from './flight-card.component';
import { PointsCardComponent } from './points-card.component';
import { TicketCardComponent } from './ticket-card.component';
import { DashboardWrapperComponent } from './dashboard-wrapper.component';
import { WorkspaceWrapperComponent } from './workspace-wrapper.component';
import { EmptyLayoutComponent } from './empty-layout.component';

/**
 * Widget registry entries for the chatless demo. Names match the
 * `components: [{ name, props }]` payloads emitted by the shared tools
 * (`@infra-tools/demo-shared-tools`), so the agent's choice of which widget
 * to render resolves cleanly through `ComponentRegistry` — exactly the
 * same path the chat shell uses, just rendered outside the chat rail.
 */
export const widgets: readonly ComponentDef[] = [
  agenticWidget({
    name: 'flightCard',
    component: FlightCardComponent,
    propsSchema: z.object({
      bookingId: z.string(),
      from: z.string(),
      to: z.string(),
      date: z.string(),
      status: z.string(),
    }),
  }),
  agenticWidget({
    name: 'pointsCard',
    component: PointsCardComponent,
    propsSchema: z.object({
      balance: z.number(),
      tier: z.string(),
    }),
  }),
  agenticWidget({
    name: 'ticketCard',
    component: TicketCardComponent,
    propsSchema: z.object({
      ticketId: z.string(),
      subject: z.string(),
      status: z.string(),
      priority: z.string(),
    }),
  }),

  // ── Agent-composer surfaces (L2 / L3) ────────────────────────────────────
  // The agent's `composeAccountDashboard` / `composeAccountWorkspace` tools
  // emit `components: [{ name: 'dashboardWrapper' | 'workspaceWrapper', … }]`;
  // these adapters then mount the lib's `<mvk-dashboard-canvas>` /
  // `<mvk-workspace-layout>`. `emptyLayout` is a placeholder type the
  // generated dashboard's `LayoutDef.component` references.
  agenticWidget({
    name: 'dashboardWrapper',
    component: DashboardWrapperComponent,
    // The dashboard def carries arbitrary nested shape; validate only the
    // top-level discriminator. The wrapper mounts the canvas which itself
    // validates downstream.
    propsSchema: z.object({ dashboard: z.unknown() }),
  }),
  agenticWidget({
    name: 'workspaceWrapper',
    component: WorkspaceWrapperComponent,
    propsSchema: z.object({ slots: z.unknown() }),
  }),
  agenticWidget({
    name: 'emptyLayout',
    component: EmptyLayoutComponent,
    propsSchema: z.object({}),
  }),
];
