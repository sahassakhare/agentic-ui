import { defineCapabilityModule } from '@maverick/agentic-ui';
import type { ToolDef } from '@maverick/agentic-ui';

import { filterByCustodiansTool } from './tools/filter-by-custodians.tool';
import { filterByDateRangeTool } from './tools/filter-by-date-range.tool';
import { runTARClassifierTool } from './tools/run-tar-classifier.tool';
import { semanticSearchTool } from './tools/semantic-search.tool';
import { dateHistogramWidget } from './widgets/date-histogram.widget';
import { searchResultPanelWidget } from './widgets/search-result-panel.widget';
import { tarScoresWidget } from './widgets/tar-scores.widget';

/**
 * `demo-ediscovery-search` capability module — Phase 4.
 *
 * @remarks
 * The four tools all route their data access through the
 * `documentIndex` `DataSourceDef`. The data source is registered
 * separately via the `./RegisterDataSource` exposed entry so the
 * host's `DataSourceRegistry` can list it; tools themselves bypass
 * the registry and address the module directly because tool handlers
 * run outside Angular's injection context.
 *
 * **Total tool count after this remote loads**: 17 (5 host + 4 review
 * + 4 production + 4 search). Phase 4 activates `provideToolFilter
 * (keywordToolFilter({ maxTools: 12, floor: 5 }))` in the host so the
 * agent's per-turn tool budget stays bounded.
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
});
