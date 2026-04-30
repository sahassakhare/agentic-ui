import { agenticTool } from '@maverick/agentic-ui';
import { searchDocuments } from '@maverick/demo-ediscovery-shared';
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
    'Search documents in the active matter by free-text query, custodians, or tags. ' +
    'Returns up to 25 matching documents with content snippets and renders a results list. ' +
    'Use this before tagging or privilege-marking when the user gives names or topics rather than document ids.',
  schema: z.object({
    query: z.string().describe('Free-text query against content + filename + author. Pass "" to match all docs.'),
    custodianIds: z.array(z.string()).optional().describe('Restrict to these custodians (e.g. ["CUST-001"])'),
    tags: z.array(z.string()).optional().describe('Restrict to documents carrying any of these tags'),
    limit: z.number().int().min(1).max(50).optional().describe('Max results to return (default 25)'),
  }),
  handler: async ({ query, custodianIds, tags, limit }) => {
    const results = searchDocuments(MATTER_ID, query, { custodianIds, tags, limit });
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
      // Render the first three matches as preview cards; the LLM summarises the rest in text.
      components: results.slice(0, 3).map((d) => ({
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
