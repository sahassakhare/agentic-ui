import { defineCapabilityModule } from '@infra-tools/agentic-ui';
import type { DashboardDef, ToolDef } from '@infra-tools/agentic-ui';

import { assignBatesNumbersTool } from './tools/assign-bates-numbers.tool';
import { createProductionSetTool } from './tools/create-production-set.tool';
import { exportProductionSetTool } from './tools/export-production-set.tool';
import { generateChainOfCustodyReportTool } from './tools/generate-chain-of-custody-report.tool';
import { redactDocumentTool } from './tools/redact-document.tool';
import { batesPreviewWidget } from './widgets/bates-preview.widget';
import { chainOfCustodyReportWidget } from './widgets/chain-of-custody-report.widget';
import { productionSummaryWidget } from './widgets/production-summary.widget';
import { redactionEditorWidget } from './widgets/redaction-editor.widget';

/**
 * Production throughput dashboard — MFE-contributed via federation.
 * Same federation-symmetry property as the review remote's
 * `reviewProductivity` dashboard; reaped by `removeBySource` on
 * unload alongside the production tools + widgets.
 */
const productionThroughputDashboard: DashboardDef = {
  name: 'productionThroughput',
  title: 'Production throughput',
  description: 'Production pipeline snapshot + workflow walk-through. MFE-contributed by demo-ediscovery-production.',
  layout: 'rail',
  version: 'v1',
  tiles: [
    {
      id: 'productions-page',
      slot: 'primary',
      title: 'Open Productions',
      component: 'kpiTile',
      invocation: { kind: 'tool', tool: 'openProductions', args: {} },
      refreshOn: 'load',
      drilldown: { route: '/productions' },
    },
    {
      id: 'production-blurb',
      slot: 'primary',
      title: 'Production pipeline',
      component: 'kpiTile',
      invocation: {
        kind: 'static',
        props: {
          markdown:
            'create → bates → redact → export → chain-of-custody. ' +
            'Each step chain-hashes through audit. Dashboard ships ' +
            'with this remote; persona scope hides tiles whose ' +
            'underlying tool the active user can\'t invoke.',
        },
      },
    },
  ],
};

/**
 * `demo-ediscovery-production` capability module.
 *
 * Exposed at `./Capability` (see `federation.config.js`). Loaded by
 * the host's `loadRemoteCapabilities` which calls `apply(injector)`
 * to write into the host's `ToolRegistry` + `ComponentRegistry` +
 * `DashboardRegistry`.
 *
 * @remarks
 * The form (`productionConfigForm`) lives in `./forms/` and is
 * registered via a separate exposed `./RegisterForm` entry — forms
 * need an Angular `EnvironmentInjector` at registration time
 * (`FormRegistry.register` consumes services), and the current
 * `defineCapabilityModule` API only takes pure data.
 *
 * **Tool chain.** A typical agent flow is:
 *   1. `createProductionSet` (status → draft)
 *   2. optional: `redactDocument` per page, per span
 *   3. `assignBatesNumbers` (status → review)
 *   4. `exportProductionSet({ deliver: true })` (status → delivered)
 */
export const capability = defineCapabilityModule({
  remoteName: 'demo-ediscovery-production',
  version: '1.0.0',
  tools: [
    createProductionSetTool as ToolDef,
    assignBatesNumbersTool as ToolDef,
    redactDocumentTool as ToolDef,
    exportProductionSetTool as ToolDef,
    generateChainOfCustodyReportTool as ToolDef,
  ],
  components: [
    productionSummaryWidget,
    batesPreviewWidget,
    redactionEditorWidget,
    chainOfCustodyReportWidget,
  ],
  dashboards: [productionThroughputDashboard],
});
