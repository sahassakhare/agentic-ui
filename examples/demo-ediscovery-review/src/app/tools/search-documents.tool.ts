import { agenticTool } from '@infra-tools/agentic-ui';
import { searchDocuments } from '@infra-tools/demo-ediscovery-shared';
import { z } from 'zod';
import { MATTER_ID } from '../matter-context';

/**
 * Naive content + filename + author search across a matter's document set.
 * Phase 4's search remote replaces this with a real DataSource (vector
 * store / full-text index) — same `ToolDef` shape, swapped backing.
 */
export const searchDocumentsTool = agenticTool({
  name: 'searchDocuments',
  description:
    'Search documents in the active matter by free-text query, custodians, ' +
    'or tags — with optional tag exclusion. Returns up to 25 matching ' +
    'documents with content snippets and renders a results list. Use this ' +
    'before tagging or privilege-marking when the user gives names or ' +
    'topics rather than document ids.\n\n' +
    'Combine `tags` + `excludeTags` for the canonical "responsive but not ' +
    'privileged" pattern: tags=["responsive"], excludeTags=["privileged"].',
  schema: z.object({
    query: z.string().describe('Free-text query against content + filename + author. Pass "" to match all docs.'),
    custodianIds: z.array(z.string()).optional().describe('Restrict to these custodians (e.g. ["CUST-001"])'),
    tags: z.array(z.string()).optional().describe(
      'Restrict to documents carrying ANY of these tags (include set). ' +
      'E.g. ["responsive"] keeps only docs tagged responsive.',
    ),
    excludeTags: z.array(z.string()).optional().describe(
      'Drop documents carrying ANY of these tags (exclude set). ' +
      'E.g. ["privileged"] drops docs marked privileged. ' +
      'Use together with `tags` for the production-set pattern ' +
      '"responsive AND NOT privileged": tags=["responsive"], excludeTags=["privileged"].',
    ),
    limit: z.number().int().min(1).max(50).optional().describe('Max results to return (default 25)'),
  }),
  handler: async ({ query, custodianIds, tags, excludeTags, limit }) => {
    const results = searchDocuments(MATTER_ID, query, { custodianIds, tags, excludeTags, limit });
    return {
      query,
      count: results.length,
      documents: results.map((d) => ({
        id: d.id,
        fileName: d.fileName,
        custodianId: d.custodianId,
        authoredBy: d.authoredBy,
        tags: d.tags,
        privilegeReason: d.privilegeReason,
      })),
      // Render every match as a preview card. The tool's `limit` param
      // (default 25, hard-capped at 50 by the Zod schema) already bounds
      // the result set, so total cards are predictable. Earlier we sliced
      // at 3 and relied on the agent's NL summary to "list the rest" — the
      // count and the rendered cards disagreed (e.g. agent says "I found
      // 4" while only 3 cards appeared), which broke trust in the UI.
      components: results.map((d) => ({
        name: 'documentPreview',
        props: {
          documentId: d.id,
          fileName: d.fileName,
          custodianId: d.custodianId,
          authoredBy: d.authoredBy ?? '—',
          authoredAt: d.authoredAt ?? '—',
          contentSnippet: d.contentSnippet,
          tags: [...d.tags],
          privilegeReason: d.privilegeReason ?? null,
        },
      })),
      markdown: results.length === 0
        ? `No documents matched **${query || '(no query)'}**.`
        : `Found **${results.length}** document(s)${query ? ` for "${query}"` : ''}:\n\n` +
          results.map((d) => `- \`${d.id}\` — ${d.fileName}${d.tags.length ? ` · _${d.tags.join(', ')}_` : ''}`).join('\n'),
    };
  },
});
