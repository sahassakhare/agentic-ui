import { defineCapabilityModule } from '@infra-tools/agentic-ui';
import type { DashboardDef, ToolDef } from '@infra-tools/agentic-ui';

import { filterByCustodiansTool } from './tools/filter-by-custodians.tool';
import { filterByDateRangeTool } from './tools/filter-by-date-range.tool';
import { runTARClassifierTool } from './tools/run-tar-classifier.tool';
import { semanticSearchTool } from './tools/semantic-search.tool';
import { dateHistogramWidget } from './widgets/date-histogram.widget';
import { searchResultPanelWidget } from './widgets/search-result-panel.widget';
import { tarScoresWidget } from './widgets/tar-scores.widget';

/**
 * Search & TAR performance dashboard — MFE-contributed via federation.
 * Federation-symmetry test bed: shipped + reaped with the search
 * remote, no host-side registration needed.
 */
const searchPerformanceDashboard: DashboardDef = {
  name: 'searchPerformance',
  title: 'Search & TAR performance',
  description: 'Index reachability + classifier health. MFE-contributed by demo-ediscovery-search.',
  layout: 'rail',
  version: 'v1',
  tiles: [
    {
      id: 'index-reach',
      slot: 'primary',
      title: 'Indexed (all matters)',
      component: 'kpiTile',
      invocation: { kind: 'tool', tool: 'semanticSearch', args: { q: '' } },
      refreshOn: 'load',
      drilldown: { route: '/documents' },
    },
    {
      id: 'search-blurb',
      slot: 'primary',
      title: 'About search + TAR',
      component: 'kpiTile',
      invocation: {
        kind: 'static',
        props: {
          markdown:
            'Search tools route through the documentIndex DataSourceDef. ' +
            'runTARClassifier is a long-running operation; results land ' +
            'in the Operations panel.',
        },
      },
    },
  ],
};

/**
 * `demo-ediscovery-search` capability module — Phase 4.
 *
 * @remarks
 * The four tools route their data access through the `documentIndex`
 * `DataSourceDef`. The data source is registered separately via the
 * `./RegisterDataSource` exposed entry so the host's
 * `DataSourceRegistry` can list it; tools themselves bypass the
 * registry and address the module directly because tool handlers run
 * outside Angular's injection context.
 *
 * **Total tool count after this remote loads**: 17 (5 host + 4 review
 * + 4 production + 4 search). Phase 4 activates `provideToolFilter
 * (keywordToolFilter({ maxTools: 12, floor: 5 }))` in the host so the
 * agent's per-turn tool budget stays bounded.
 *
 * **Federation symmetry (post-chat-surfaces post-P5)**: this module
 * also ships a `DashboardDef` that appears in the host's
 * `DashboardRegistry`. `removeBySource` reaps it on unload.
 */
export const capability = defineCapabilityModule({
  remoteName: 'demo-ediscovery-search',
  version: '1.0.0',
  tools: [
    semanticSearchTool as ToolDef,
    filterByDateRangeTool as ToolDef,
    filterByCustodiansTool as ToolDef,
    runTARClassifierTool as ToolDef,
  ],
  components: [
    searchResultPanelWidget,
    dateHistogramWidget,
    tarScoresWidget,
  ],
  dashboards: [searchPerformanceDashboard],
});
