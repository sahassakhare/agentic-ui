import { ChangeDetectionStrategy, Component, EnvironmentInjector, input } from '@angular/core';
import {
  agenticWidget,
  ComponentRegistry,
  DashboardRegistry,
  PlaybookRegistry,
  TriggerRegistry,
  type DashboardDef,
  type PlaybookDef,
  type TriggerDef,
} from '@infra-tools/agentic-ui';
import { z } from 'zod';

/**
 * `kpiTile` — generic dashboard-tile renderer. Receives whatever the
 * underlying tool / data source / static-prop returned via `value`,
 * and renders a count + label. Designed to handle the three common
 * shapes the existing eDiscovery tools return:
 *
 * - `number` literal → renders as-is.
 * - `T[]` → renders `value.length`.
 * - `{ count: number, label?: string }` → renders `count` + label.
 * - `{ markdown: string }` → renders the markdown body as plain text
 *   (good enough for the demo's static tiles).
 */
@Component({
  selector: 'app-kpi-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (markdown(); as md) {
      <p class="md">{{ md }}</p>
    } @else if (count(); as info) {
      <div class="kpi">
        <strong>{{ info.n }}</strong>
        <span class="lbl">{{ info.label }}</span>
      </div>
    } @else {
      <pre class="raw">{{ rawJson() }}</pre>
    }
  `,
  styles: `
    :host { display: block; height: 100%; }
    .kpi { display: flex; flex-direction: column; gap: 0.2rem; }
    .kpi strong { font-size: 2rem; line-height: 1.1; color: #111827; }
    .lbl { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; }
    .md { margin: 0; font-size: 0.85rem; color: #374151; line-height: 1.4; }
    .raw { font-size: 0.7rem; color: #6b7280; overflow: auto; max-height: 100%; margin: 0; }
  `,
})
export class KpiTileComponent {
  readonly value = input<unknown>(null);

  protected markdown(): string | null {
    const v = this.value();
    if (v && typeof v === 'object' && 'markdown' in v && typeof (v as { markdown: unknown }).markdown === 'string') {
      return (v as { markdown: string }).markdown;
    }
    return null;
  }

  protected count(): { n: number; label: string } | null {
    const v = this.value();
    if (typeof v === 'number') return { n: v, label: 'items' };
    if (Array.isArray(v)) return { n: v.length, label: 'items' };
    if (v && typeof v === 'object' && 'count' in v && typeof (v as { count: unknown }).count === 'number') {
      const obj = v as { count: number; label?: string };
      return { n: obj.count, label: obj.label ?? 'items' };
    }
    return null;
  }

  protected rawJson(): string {
    try { return JSON.stringify(this.value(), null, 2); } catch { return ''; }
  }
}

const kpiTileWidget = agenticWidget({
  name: 'kpiTile',
  component: KpiTileComponent,
  propsSchema: z.object({ value: z.unknown() }),
});

const matterHealthDashboard: DashboardDef = {
  name: 'matterHealth',
  title: 'Matter health',
  description: 'Live KPIs for the active matter — holds, custodians, recent productions.',
  layout: 'rail',  // any registered layout name; canvas falls back gracefully.
  version: 'v1',
  tiles: [
    {
      id: 'pending-holds',
      slot: 'primary',
      title: 'Pending hold acknowledgements',
      component: 'kpiTile',
      invocation: { kind: 'tool', tool: 'listLegalHolds', args: { status: 'pending' } },
      refreshOn: 'load',
      drilldown: { route: '/holds' },
      explainable: true,
    },
    {
      id: 'active-custodians',
      slot: 'primary',
      title: 'Custodians on hold',
      component: 'kpiTile',
      invocation: { kind: 'tool', tool: 'listCustodians', args: { onHold: true } },
      refreshOn: 'load',
      drilldown: { route: '/custodians' },
    },
    {
      id: 'intro',
      slot: 'primary',
      title: 'About this dashboard',
      component: 'kpiTile',
      invocation: {
        kind: 'static',
        props: {
          markdown:
            'Tiles re-invoke the underlying tool on demand — chain-hashed each ' +
            "time. Drill in by clicking a tile body to navigate to the source page.",
        },
      },
    },
  ],
};

const initialPrivilegePassPlaybook: PlaybookDef = {
  name: 'initialPrivilegePass',
  title: 'Initial privilege pass v1',
  description:
    'Cross-matter privilege review — collects current matter state, then ' +
    'enumerates pending holds + custodians for the reviewer. Each step ' +
    'chain-hashes with origin: "playbook".',
  version: 'v1',
  steps: [
    {
      id: 'list-holds',
      title: 'List pending holds',
      tool: 'listLegalHolds',
      args: { status: 'pending' },
    },
    {
      id: 'list-custodians',
      title: 'List custodians on hold',
      tool: 'listCustodians',
      args: { onHold: true },
      continueOnError: true,
    },
    {
      id: 'open-approvals',
      title: 'Open the approvals queue',
      tool: 'openApprovals',
      args: {},
      requiresApproval: true,
    },
  ],
};

const dailyAckSweepTrigger: TriggerDef = {
  name: 'dailyAckSweep',
  description:
    'Daily sweep of pending hold acknowledgements. Emits a notification when ' +
    'any custodian has not yet acknowledged their hold.',
  kind: 'cron',
  spec: { kind: 'cron', expression: '@daily' },
  target: {
    kind: 'notification',
    compose: (ctx) => ({
      title: 'Daily acknowledgement sweep',
      body:
        `Run at ${ctx.firedAt}. Check the Holds page for pending custodian ` +
        'acknowledgements.',
      severity: 'info',
      cta: { kind: 'route', target: '/holds' },
    }),
  },
  runAs: 'caseManager',
};

/**
 * Boot-time registration for the post-chat-surfaces program (P0-P5).
 * Called from `bootAgenticCapabilities()` after tools register, so
 * dashboards + playbooks can reference tool names that already exist.
 */
export function registerPostChatSurfaces(env: EnvironmentInjector): void {
  env.get(ComponentRegistry).register(kpiTileWidget);
  env.get(TriggerRegistry).register(dailyAckSweepTrigger);
  env.get(DashboardRegistry).register(matterHealthDashboard);
  env.get(PlaybookRegistry).register(initialPrivilegePassPlaybook);
}
