import { defineCapabilityModule } from '@maverick/agentic-ui';
import type { ToolDef } from '@maverick/agentic-ui';

import { assignBatesNumbersTool } from './tools/assign-bates-numbers.tool';
import { createProductionSetTool } from './tools/create-production-set.tool';
import { exportProductionSetTool } from './tools/export-production-set.tool';
import { redactDocumentTool } from './tools/redact-document.tool';
import { batesPreviewWidget } from './widgets/bates-preview.widget';
import { productionSummaryWidget } from './widgets/production-summary.widget';
import { redactionEditorWidget } from './widgets/redaction-editor.widget';

/**
 * `demo-ediscovery-production` capability module.
 *
 * Exposed at `./Capability` (see `federation.config.js`). Loaded by
 * the host's `loadRemoteCapabilities` which calls `apply(injector)`
 * to write into the host's `ToolRegistry` and `ComponentRegistry`.
 *
 * @remarks
 * The form (`productionConfigForm`) lives in `./forms/` and is
 * registered via a separate exposed `./RegisterForm` entry — forms
 * need an Angular `EnvironmentInjector` at registration time
 * (`FormRegistry.register` consumes services), and the current
 * `defineCapabilityModule` API only takes pure data. Phase 1.6
 * governance work will fold form registration into the same module.
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
  ],
  components: [
    productionSummaryWidget,
    batesPreviewWidget,
    redactionEditorWidget,
  ],
});
