import { agenticDataSource, type DataSourceDef } from '@maverick/agentic-ui';
import {
  classifyDocuments,
  dateHistogram,
  filterByDateRange,
  listDocuments,
  semanticRank,
  type DateBucket,
  type Document,
  type SemanticHit,
  type TARScore,
} from '@maverick/demo-ediscovery-shared';
import { MATTER_ID } from '../matter-context';

/**
 * Discriminated query types the `documentIndex` data source accepts.
 * Each tool builds one of these and calls `adapter(query)`; the source
 * dispatches by `op`.
 *
 * @remarks
 * Real eDiscovery vendors back this with a vector-store / Lucene
 * cluster. The query shape stays stable across the swap because tools
 * never see the underlying implementation.
 */
export type IndexQuery =
  | {
      op: 'rank';
      query: string;
      custodianIds?: readonly string[];
      tags?: readonly string[];
      limit?: number;
    }
  | {
      op: 'date-range';
      from?: string;
      to?: string;
      custodianIds?: readonly string[];
    }
  | {
      op: 'histogram';
      unit?: 'month' | 'quarter' | 'year';
      custodianIds?: readonly string[];
    }
  | {
      op: 'classify';
      topic: string;
      onlyUntagged?: boolean;
      custodianIds?: readonly string[];
    };

export type IndexResult =
  | { kind: 'rank';      hits: readonly SemanticHit[] }
  | { kind: 'documents'; documents: readonly Document[] }
  | { kind: 'histogram'; buckets: readonly DateBucket[]; total: number }
  | { kind: 'classify';  scores: readonly TARScore[] };

/**
 * `documentIndex` — the only entry point search tools use to query the
 * matter's document set. Implemented as a `DataSourceDef` so the
 * underlying transport (in-memory mock today, vector store tomorrow)
 * is swappable without touching tool handlers.
 */
export const documentIndexDataSource: DataSourceDef = agenticDataSource({
  name: 'documentIndex',
  kind: 'http',
  adapter: async (raw: unknown): Promise<IndexResult> => {
    const query = raw as IndexQuery;
    const allDocs = listDocuments(MATTER_ID);
    const scoped = query.custodianIds?.length
      ? allDocs.filter((d) => query.custodianIds!.includes(d.custodianId))
      : allDocs;

    switch (query.op) {
      case 'rank':
        return {
          kind: 'rank',
          hits: semanticRank(MATTER_ID, query.query, {
            custodianIds: query.custodianIds,
            tags: query.tags,
            limit: query.limit,
          }),
        };
      case 'date-range':
        return {
          kind: 'documents',
          documents: filterByDateRange(scoped, query.from, query.to),
        };
      case 'histogram': {
        const buckets = dateHistogram(scoped, query.unit ?? 'month');
        const total = buckets.reduce((n, b) => n + b.count, 0);
        return { kind: 'histogram', buckets, total };
      }
      case 'classify': {
        const target = query.onlyUntagged
          ? scoped.filter((d) => d.tags.length === 0)
          : scoped;
        return { kind: 'classify', scores: classifyDocuments(target, query.topic) };
      }
    }
  },
});
