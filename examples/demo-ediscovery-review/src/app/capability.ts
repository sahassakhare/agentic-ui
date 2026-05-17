import { defineCapabilityModule } from '@infra-tools/agentic-ui';
import type { DashboardDef, ToolDef } from '@infra-tools/agentic-ui';

import { addToPrivilegeLogTool } from './tools/add-to-privilege-log.tool';
import { markPrivilegedTool } from './tools/mark-privileged.tool';
import { searchDocumentsTool } from './tools/search-documents.tool';
import { tagDocumentTool } from './tools/tag-document.tool';
import { documentPreviewWidget } from './widgets/document-preview.widget';
import { reviewProgressWidget } from './widgets/review-progress.widget';
import { tagPanelWidget } from './widgets/tag-panel.widget';

/**
 * Reviewer productivity dashboard — MFE-contributed via federation.
 *
 * Demonstrates the post-chat-surfaces federation-symmetry property:
 * an MFE remote ships `DashboardDef`s alongside its tools + widgets,
 * the host's `DashboardRegistry` indexes them with
 * `source: 'remote:demo-ediscovery-review'`. Unloading the remote
 * runs `removeBySource` across all 18 registries — the dashboard
 * disappears symmetrically with its tools.
 *
 * Tiles reference the host's `kpiTile` widget (registered in
 * `registerPostChatSurfaces` at host boot) by name; ComponentRegistry
 * resolves at render time so this remote doesn't ship its own tile
 * component.
 */
const reviewProductivityDashboard: DashboardDef = {
  name: 'reviewProductivity',
  title: 'Reviewer productivity',
  description: 'Doc indexing snapshot + privilege-pass blurb. MFE-contributed by demo-ediscovery-review.',
  layout: 'rail',
  version: 'v1',
  tiles: [
    {
      id: 'docs-indexed',
      slot: 'primary',
      title: 'Documents indexed',
      component: 'kpiTile',
      invocation: { kind: 'tool', tool: 'searchDocuments', args: { q: '' } },
      refreshOn: 'load',
      drilldown: { route: '/documents' },
    },
    {
      id: 'review-blurb',
      slot: 'primary',
      title: 'About this dashboard',
      component: 'kpiTile',
      invocation: {
        kind: 'static',
        props: {
          markdown:
            'Shipped by the review MFE remote. removeBySource reaps ' +
            'this dashboard symmetrically with the remote on unload.',
        },
      },
    },
  ],
};

/**
 * `demo-ediscovery-review` capability module.
 *
 * Exposed at `./Capability` (see `federation.config.js`). The host's
 * `loadRemoteCapabilities` calls `apply(injector)` which writes into
 * the host's `ToolRegistry` / `ComponentRegistry` / `DashboardRegistry`
 * (singletons through the federation `shared: '@infra-tools/agentic-ui'`
 * config). Federation symmetry (post-chat-surfaces post-P5): tools,
 * components, and dashboards all carry `source: 'remote:<name>'` and
 * are reaped by a single `removeBySource` pass on unload.
 */
export const capability = defineCapabilityModule({
  remoteName: 'demo-ediscovery-review',
  version: '1.0.0',
  tools: [
    searchDocumentsTool as ToolDef,
    tagDocumentTool as ToolDef,
    markPrivilegedTool as ToolDef,
    addToPrivilegeLogTool as ToolDef,
  ],
  components: [
    documentPreviewWidget,
    tagPanelWidget,
    reviewProgressWidget,
  ],
  dashboards: [reviewProductivityDashboard],
});
