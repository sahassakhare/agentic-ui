import { agenticTool } from '@infra-tools/agentic-ui';
import { getCustodian } from '@infra-tools/demo-ediscovery-shared';
import { z } from 'zod';
import { documentIndexDataSource, type IndexQuery, type IndexResult } from '../data-sources/document-index.data-source';

/**
 * Filter the matter's documents to those authored within a date range,
 * optionally restricted to specific custodians. Returns the matching
 * docs plus a histogram widget so the agent can show the user what
 * the result looks like distributionally.
 */
export const filterByDateRangeTool = agenticTool({
  name: 'filterByDateRange',
  description:
    'Return all documents authored within an ISO-date range, optionally ' +
    'scoped to specific custodians. Use when the user gives a time window ' +
    '("from January", "in Q1 2025"). Both `from` and `to` are inclusive ' +
    'on the start, exclusive on the end (left-closed). Pair with ' +
    '`semanticSearch` or `runTARClassifier` to score the filtered set.',
  schema: z.object({
    from: z.string().optional().describe("Start ISO date (e.g. '2025-01-01')"),
    to: z.string().optional().describe("End ISO date (exclusive — e.g. '2025-04-01' for Q1)"),
    custodianIds: z.array(z.string()).optional().describe('Restrict to these custodians'),
  }),
  handler: async ({ from, to, custodianIds }) => {
    const dateQuery: IndexQuery = { op: 'date-range', from, to, custodianIds };
    const dateResult = await documentIndexDataSource.adapter(dateQuery) as IndexResult;
    const docs = dateResult.kind === 'documents' ? dateResult.documents : [];

    const histQuery: IndexQuery = { op: 'histogram', unit: 'month', custodianIds };
    const histResult = await documentIndexDataSource.adapter(histQuery) as IndexResult;
    const buckets = histResult.kind === 'histogram' ? histResult.buckets : [];

    const range = `${from ?? '—'} → ${to ?? '—'}`;
    return {
      from, to,
      count: docs.length,
      documents: docs.map((d) => ({
        id: d.id,
        fileName: d.fileName,
        custodianId: d.custodianId,
        authoredAt: d.authoredAt,
        tags: d.tags,
      })),
      components: buckets.length === 0 ? [] : [{
        name: 'dateHistogram',
        props: {
          title: `Documents per month` + (custodianIds?.length ? ' · scoped' : ''),
          range,
          buckets: buckets.map((b) => ({
            key: b.key,
            label: b.label,
            count: b.count,
            inRange: (!from || b.toIso > from) && (!to || b.fromIso < to),
          })),
        },
      }],
      markdown:
        `Found **${docs.length}** doc(s) in window \`${range}\`` +
        (custodianIds?.length ? ` (custodians: ${custodianIds.length})` : '') + `.\n\n` +
        (docs.length === 0
          ? '_No documents in this window._'
          : docs.slice(0, 5).map((d) =>
              `- \`${d.id}\` — ${d.fileName} · ${d.authoredAt?.slice(0, 10) ?? '—'}` +
              ` · _${getCustodian(d.custodianId)?.name ?? d.custodianId}_`
            ).join('\n')),
    };
  },
});
