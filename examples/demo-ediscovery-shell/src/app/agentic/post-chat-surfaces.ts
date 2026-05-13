import { ChangeDetectionStrategy, Component, EnvironmentInjector, input } from '@angular/core';
import {
  agenticIntent,
  agenticWidget,
  ComponentRegistry,
  DashboardRegistry,
  IntentRegistry,
  PlaybookRegistry,
  TriggerRegistry,
  type DashboardDef,
  type IntentDef,
  type PlaybookDef,
  type TriggerDef,
} from '@infra-tools/agentic-ui';
import { z } from 'zod';

/**
 * `kpiTile` — generic dashboard-tile renderer. Receives whatever the
 * underlying tool / data source / static-prop returned via `value`,
 * and renders a count + label. Handles the common shapes the
 * existing eDiscovery tools return:
 *
 * - `number` literal → renders as-is.
 * - `T[]` → renders `value.length`.
 * - `{ count: number, label?: string }` → renders `count` + label.
 * - `{ markdown: string }` → renders the markdown body as plain text.
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

// ── Dashboards ─────────────────────────────────────────────────────────

const matterHealthDashboard: DashboardDef = {
  name: 'matterHealth',
  title: 'Matter health',
  description: 'Live KPIs for the active matter — holds, custodians, recent productions.',
  layout: 'rail',
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
            'time. Drill in by clicking a tile body to navigate to the source page.',
        },
      },
    },
  ],
};

const productionStatusDashboard: DashboardDef = {
  name: 'productionStatus',
  title: 'Production status',
  description: 'Snapshot of production runs in flight, finished, and awaiting QC.',
  layout: 'rail',
  version: 'v1',
  tiles: [
    {
      id: 'open-holds',
      slot: 'primary',
      title: 'Open legal holds',
      component: 'kpiTile',
      invocation: { kind: 'tool', tool: 'listLegalHolds', args: { status: 'all' } },
      refreshOn: 'load',
      drilldown: { route: '/holds' },
    },
    {
      id: 'productions-page',
      slot: 'primary',
      title: 'Open the Productions page',
      component: 'kpiTile',
      invocation: { kind: 'tool', tool: 'openProductions', args: {} },
      refreshOn: 'load',
      drilldown: { route: '/productions' },
    },
    {
      id: 'production-readme',
      slot: 'primary',
      title: 'Production workflow',
      component: 'kpiTile',
      invocation: {
        kind: 'static',
        props: {
          markdown:
            'Production pipeline: createProductionSet → assignBatesNumbers → ' +
            'redactDocument → exportProductionSet → generateChainOfCustodyReport. ' +
            'Each step chain-hashes through audit.',
        },
      },
    },
  ],
};

const auditSnapshotDashboard: DashboardDef = {
  name: 'auditSnapshot',
  title: 'Audit snapshot',
  description: 'Cross-matter audit context — open the Audit Trail for full history.',
  layout: 'rail',
  version: 'v1',
  tiles: [
    {
      id: 'all-holds',
      slot: 'primary',
      title: 'Holds in chain',
      component: 'kpiTile',
      invocation: { kind: 'tool', tool: 'listLegalHolds', args: {} },
      refreshOn: 'load',
      drilldown: { route: '/audit' },
    },
    {
      id: 'audit-blurb',
      slot: 'primary',
      title: 'Chain-of-custody',
      component: 'kpiTile',
      invocation: {
        kind: 'static',
        props: {
          markdown:
            'Every approval / operation / playbook step appends an entry to the ' +
            'audit chain (prevHash → chainHash). Tamper-evident; verify with ' +
            'verifyAuditChain() at any time.',
        },
      },
    },
  ],
};

// ── Playbooks ──────────────────────────────────────────────────────────

const initialPrivilegePassPlaybook: PlaybookDef = {
  name: 'initialPrivilegePass',
  title: 'Initial privilege pass v1',
  description:
    'First-pass privilege review — list pending holds + custodians + open the ' +
    'approvals queue. Each step chain-hashes with origin: "playbook".',
  version: 'v1',
  steps: [
    { id: 'list-holds',      title: 'List pending holds',         tool: 'listLegalHolds', args: { status: 'pending' } },
    { id: 'list-custodians', title: 'List custodians on hold',    tool: 'listCustodians', args: { onHold: true }, continueOnError: true },
    { id: 'open-approvals',  title: 'Open the approvals queue',   tool: 'openApprovals',  args: {}, requiresApproval: true },
  ],
};

const qcPrivilegePassPlaybook: PlaybookDef = {
  name: 'qcPrivilegePass',
  title: 'QC privilege pass v2',
  description:
    'Second-pass QC after the initial privilege pass. Same pre-flight as v1, ' +
    'with an explicit TAR-classifier refresh before opening the queue.',
  version: 'v2',
  parentVersion: 'v1',  // links the edit history
  steps: [
    { id: 'list-holds',       title: 'List pending holds',       tool: 'listLegalHolds',  args: { status: 'pending' } },
    { id: 'refresh-classifier', title: 'Refresh TAR classifier', tool: 'runTARClassifier', args: { mode: 'incremental' }, continueOnError: true },
    { id: 'list-custodians',  title: 'List custodians on hold',  tool: 'listCustodians',  args: { onHold: true } },
    { id: 'open-approvals',   title: 'Open the approvals queue', tool: 'openApprovals',   args: {}, requiresApproval: true },
  ],
};

const productionReleasePlaybook: PlaybookDef = {
  name: 'productionRelease',
  title: 'Production release',
  description:
    'Production handoff — open Productions, generate chain-of-custody for the ' +
    'latest set, request approval before export. Senior QC must approve.',
  version: 'v1',
  steps: [
    { id: 'open-productions',  title: 'Open the Productions page',     tool: 'openProductions',                args: {} },
    { id: 'open-operations',   title: 'Open the Operations panel',     tool: 'openOperations',                 args: {}, continueOnError: true },
    { id: 'open-approvals',    title: 'Open approvals for sign-off',   tool: 'openApprovals',                  args: {}, requiresApproval: true },
  ],
};

// ── Triggers ───────────────────────────────────────────────────────────

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
      body: `Run at ${ctx.firedAt}. Check the Holds page for pending custodian acknowledgements.`,
      severity: 'info',
      cta: { kind: 'route', target: '/holds' },
    }),
  },
  runAs: 'paralegal',
};

const productionReadyTrigger: TriggerDef = {
  name: 'productionReadyWebhook',
  description:
    'Webhook fired by the production server when a Bates pass completes. ' +
    'Drops a notification with a deep-link to the Productions page.',
  kind: 'webhook',
  spec: { kind: 'webhook', path: '/hooks/production-ready' },
  target: {
    kind: 'notification',
    compose: (ctx) => ({
      title: 'Production set ready for QC',
      body: `Production handoff at ${ctx.firedAt}. Review before export.`,
      severity: 'warning',
      cta: { kind: 'route', target: '/productions' },
    }),
  },
  runAs: 'lit-support',
};

const ingestCompleteTrigger: TriggerDef = {
  name: 'ingestCompleteQueue',
  description:
    'Queue event fired by the ingest pipeline. Refreshes the Custodians page ' +
    'so newly-onboarded custodians appear without a manual reload.',
  kind: 'queue',
  spec: { kind: 'queue', topic: 'matters.ingest.complete' },
  target: { kind: 'action', action: 'openCustodian' },
  runAs: 'lit-support',
};

// ── IntentRegistry — power row-action-menu + bulk-toolbar + assist-panel ──

const documentRowIntents: readonly IntentDef[] = [
  agenticIntent({
    id: 'doc.row.markPrivileged',
    description: 'Mark this document as privileged',
    examples: ['mark privileged', 'flag as priv', 'attorney-client'],
    schema: z.object({ documentId: z.string() }),
    mapsTo: { kind: 'tool', target: 'markPrivileged' },
  }) as IntentDef,
  agenticIntent({
    id: 'doc.row.tagResponsive',
    description: 'Tag this document responsive',
    examples: ['tag responsive', 'mark responsive'],
    schema: z.object({ documentId: z.string() }),
    mapsTo: { kind: 'tool', target: 'tagDocument' },
  }) as IntentDef,
  agenticIntent({
    id: 'doc.row.addPrivilegeLog',
    description: 'Add to the privilege log',
    examples: ['add to privilege log', 'log this'],
    schema: z.object({ documentId: z.string() }),
    mapsTo: { kind: 'tool', target: 'addToPrivilegeLog' },
  }) as IntentDef,
];

const documentBulkIntents: readonly IntentDef[] = [
  agenticIntent({
    id: 'doc.bulk.markPrivileged',
    description: 'Mark selected as privileged',
    examples: ['bulk mark privileged'],
    schema: z.object({ documentIds: z.array(z.string()) }),
    mapsTo: { kind: 'tool', target: 'markPrivileged' },
  }) as IntentDef,
  agenticIntent({
    id: 'doc.bulk.addPrivilegeLog',
    description: 'Add selected to privilege log',
    examples: ['bulk add to privilege log'],
    schema: z.object({ documentIds: z.array(z.string()) }),
    mapsTo: { kind: 'tool', target: 'addToPrivilegeLog' },
  }) as IntentDef,
  agenticIntent({
    id: 'doc.bulk.runTAR',
    description: 'Run TAR classifier on selected',
    examples: ['run TAR on selection', 'classify these'],
    schema: z.object({ documentIds: z.array(z.string()) }),
    mapsTo: { kind: 'tool', target: 'runTARClassifier' },
  }) as IntentDef,
];

/**
 * Exported so the Documents page can pass these ids into
 * `<mvk-row-action-menu>` + `<mvk-bulk-toolbar>` — the components
 * accept an explicit allow-list of intent ids and persona-filter
 * them at render time.
 */
export const DOCUMENT_ROW_INTENT_IDS  = documentRowIntents.map((i) => i.id);
export const DOCUMENT_BULK_INTENT_IDS = documentBulkIntents.map((i) => i.id);

/**
 * Boot-time registration for the post-chat-surfaces program (P0-P5).
 * Called from `bootAgenticCapabilities()` after tools register, so
 * dashboards + playbooks can reference tool names that already exist.
 */
export function registerPostChatSurfaces(env: EnvironmentInjector): void {
  env.get(ComponentRegistry).register(kpiTileWidget);
  const triggers = env.get(TriggerRegistry);
  triggers.register(dailyAckSweepTrigger);
  triggers.register(productionReadyTrigger);
  triggers.register(ingestCompleteTrigger);
  const dashboards = env.get(DashboardRegistry);
  dashboards.register(matterHealthDashboard);
  dashboards.register(productionStatusDashboard);
  dashboards.register(auditSnapshotDashboard);
  const playbooks = env.get(PlaybookRegistry);
  playbooks.register(initialPrivilegePassPlaybook);
  playbooks.register(qcPrivilegePassPlaybook);
  playbooks.register(productionReleasePlaybook);
  const intents = env.get(IntentRegistry);
  for (const intent of [...documentRowIntents, ...documentBulkIntents]) intents.register(intent);
}
