import { inject, makeEnvironmentProviders, provideEnvironmentInitializer, type EnvironmentProviders } from '@angular/core';
import {
  agenticApproval,
  agenticTool,
  agenticWidget,
  ApprovalCardComponent,
  ApprovalRegistry,
  type ComponentDef,
  type ToolDef,
} from '@infra-tools/agentic-ui';
import { sharedTools } from '@infra-tools/demo-shared-tools';
import { z } from 'zod';
import { FlightCardComponent } from './flight-card.component';
import { PointsCardComponent } from './points-card.component';
import { TicketCardComponent } from './ticket-card.component';
import { RedeemSummaryComponent } from './redeem-summary.component';

/**
 * Tools come from `@infra-tools/demo-shared-tools` — the SAME zero-Angular
 * `ToolDef[]` the Node `demo-mcp-server` registers. One definition, no
 * drift (Phase 0 of the unified-agentic-protocol-interface plan).
 *
 * Widgets stay here because they ARE Angular components — only the host
 * app can register the `flightCard` widget the `bookFlight` tool's
 * `components` render-hint points at. The other shared tools (checkPoints,
 * openTicket) carry only markdown, so the chat shell renders them without
 * a bespoke widget.
 *
 * In a real app these would live in an MFE remote loaded via
 * `loadRemoteCapabilities`; the demo registers them directly via the
 * `provideAgenticUiPlatform({ tools, widgets, ... })` facade.
 */

export const flightCardWidget = agenticWidget({
  name: 'flightCard',
  component: FlightCardComponent,
  propsSchema: z.object({
    bookingId: z.string(),
    from: z.string(),
    to: z.string(),
    date: z.string(),
    status: z.string(),
  }),
});

export const pointsCardWidget = agenticWidget({
  name: 'pointsCard',
  component: PointsCardComponent,
  propsSchema: z.object({
    balance: z.number(),
    tier: z.string(),
  }),
});

export const ticketCardWidget = agenticWidget({
  name: 'ticketCard',
  component: TicketCardComponent,
  propsSchema: z.object({
    ticketId: z.string(),
    subject: z.string(),
    status: z.string(),
    priority: z.string(),
  }),
});

// ── Human-in-the-loop (Capability F4) ───────────────────────────────────────
// `redeemPoints` is approval-gated: when the agent calls it, the chat shell
// intercepts and shows an approval card (with the `redeem-summary` diff). The
// handler runs only after the user approves. Reject cancels the call.

export const redeemPointsTool = agenticTool({
  name: 'redeemPoints',
  description:
    'Redeem loyalty points for a reward (e.g. a seat upgrade or lounge pass). ' +
    'High-impact — always requires human approval before it executes.',
  schema: z.object({
    points: z.number().describe('Number of points to redeem'),
    reward: z.string().describe('What the points are redeemed for (e.g. "lounge pass")'),
  }),
  handler: async ({ points, reward }) => {
    const confirmation = `RDM-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    return {
      confirmation,
      points,
      reward,
      markdown: `**Redeemed** ${points.toLocaleString()} pts for **${reward}** — confirmation \`${confirmation}\`.`,
    };
  },
});

/** The lib's approval card, registered under the name the chat shell emits. */
export const approvalCardWidget = agenticWidget({
  name: 'mvk-approval-card',
  component: ApprovalCardComponent,
  propsSchema: z.object({ approvalId: z.string() }),
});

/** Diff renderer the approval card mounts to show what's being approved. */
export const redeemSummaryWidget = agenticWidget({
  name: 'redeem-summary',
  component: RedeemSummaryComponent,
  propsSchema: z.object({}),
});

export const tools: ToolDef[] = [...sharedTools, redeemPointsTool as ToolDef];
export const widgets: ComponentDef[] = [
  flightCardWidget,
  pointsCardWidget,
  ticketCardWidget,
  approvalCardWidget,
  redeemSummaryWidget,
];

/**
 * Registers the `redeemPoints` approval policy at boot. Added to the
 * platform facade's `extraProviders`. `required: () => true` always gates
 * the tool; production policies branch on `args` / persona.
 */
export function provideDojoApprovals(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideEnvironmentInitializer(() => {
      inject(ApprovalRegistry).register(
        agenticApproval({
          tool: 'redeemPoints',
          required: () => true,
          approverRoles: ['traveler'],
          diffRenderer: 'redeem-summary',
          signoffMessage: (args) => {
            const a = (args ?? {}) as { points?: number; reward?: string };
            return `Redeem ${Number(a.points ?? 0).toLocaleString()} points for ${a.reward ?? 'a reward'}?`;
          },
        }),
      );
    }),
  ]);
}
