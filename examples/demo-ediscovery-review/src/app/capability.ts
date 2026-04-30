import { defineCapabilityModule } from '@maverick/agentic-ui';
import type { ToolDef } from '@maverick/agentic-ui';

import { addToPrivilegeLogTool } from './tools/add-to-privilege-log.tool';
import { markPrivilegedTool } from './tools/mark-privileged.tool';
import { searchDocumentsTool } from './tools/search-documents.tool';
import { tagDocumentTool } from './tools/tag-document.tool';
import { documentPreviewWidget } from './widgets/document-preview.widget';
import { reviewProgressWidget } from './widgets/review-progress.widget';
import { tagPanelWidget } from './widgets/tag-panel.widget';

/**
 * `demo-ediscovery-review` capability module.
 *
 * @remarks
 * Exposed at `./Capability` (see `federation.config.js`). The host's
 * `loadRemoteCapabilities` calls `apply(injector)` which writes into
 * the host's `ToolRegistry` / `ComponentRegistry` (singletons through
 * the federation `shared: '@maverick/agentic-ui'` config).
 *
 * **What's NOT here yet**: the `openDocumentAction` listed in the
 * Phase 2 plan would navigate the host to a `/documents/:id` route.
 * That route belongs in the host, and the host's `agentic.ts` is the
 * right place to register the action against the host's `Router`.
 * We'll add it alongside the production remote in Phase 3 (the
 * production-set workflow needs document navigation too — natural
 * place to land it).
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
});
