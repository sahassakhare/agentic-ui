import { agenticTool } from '@maverick/agentic-ui';
import { getCustodian, type SemanticHit } from '@maverick/demo-ediscovery-shared';
import { z } from 'zod';
import { documentIndexDataSource, type IndexQuery, type IndexResult } from '../data-sources/document-index.data-source';

/**
 * Semantic search across the matter's document set. Routes through the
 * `documentIndex` data source so the underlying ranker is swappable.
 *
 * @remarks
 * Today's adapter is a mock similarity model in shared/. Phase 5 wires
 * a real vector store (Weaviate / pgvector / OpenAI embeddings); this
 * tool's signature stays identical because `DataSourceRegistry` hides
 * the transport.
 */
export const semanticSearchTool = agenticTool({
  name: 'semanticSearch',
  description:
    'Rank documents by semantic similarity to a free-text query. ' +
    'Use this when the user asks "find documents about X" or "similar to DOC-Y" — ' +
    'returns a ranked list with confidence scores. Pair with filterByDateRange ' +
    'or filterByCustodians to narrow before ranking.',
  schema: z.object({
    query: z.string().min(2).describe('Natural-language query; will be tokenised'),
    custodianIds: z.array(z.string()).optional().describe('Restrict to specific custodians'),
    tags: z.array(z.string()).optional().describe('Restrict to docs carrying any of these tags'),
    limit: z.number().int().min(1).max(50).optional().describe('Max results (default 10)'),
  }),
  handler: async ({ query, custodianIds, tags, limit }) => {
    // Tool handlers run outside Angular's injection context — we
    // address the data-source module directly. The host's
    // DataSourceRegistry still receives a registration so the seam is
    // visible to tooling / inspectors.
    const indexQuery: IndexQuery = { op: 'rank', query, custodianIds, tags, limit };
    const result = await documentIndexDataSource.adapter(indexQuery) as IndexResult;
    if (result.kind !== 'rank') {
      return { error: 'Unexpected data-source result', markdown: '⚠️ Unexpected response shape from documentIndex.' };
    }
    const hits = result.hits;

    return {
      query,
      count: hits.length,
      hits: hits.map((h: SemanticHit) => ({
        documentId: h.document.id,
        fileName: h.document.fileName,
        score: Number(h.score.toFixed(3)),
        matched: h.matched,
      })),
      components: hits.length === 0 ? [] : [{
        name: 'searchResultPanel',
        props: {
          query,
          count: hits.length,
          hits: hits.slice(0, 8).map((h) => ({
            documentId: h.document.id,
            fileName: h.document.fileName,
            custodianName: getCustodian(h.document.custodianId)?.name ?? h.document.custodianId,
            score: Number(h.score.toFixed(3)),
            matched: [...h.matched],
            tags: [...h.document.tags],
          })),
        },
      }],
      markdown: hits.length === 0
        ? `No documents matched **${query}**.`
        : `Found **${hits.length}** doc(s) ranked by similarity to "${query}":\n\n` +
          hits.slice(0, 5).map((h) =>
            `- \`${h.document.id}\` — ${h.document.fileName} · score \`${h.score.toFixed(2)}\``
          ).join('\n'),
    };
  },
});
