/**
 * Mock search utilities — semantic-similarity-ish ranking, date
 * histograms, TAR (Technology-Assisted Review) classifier scores.
 *
 * @remarks
 * Demo-grade. Real eDiscovery vendors back semanticSearch with a
 * vector store (Vespa, Weaviate, pgvector) and TAR with a trained
 * classifier (LDA / SVM / fine-tuned LLM). The shapes here mirror
 * those production interfaces — swap the implementation, keep the
 * `DataSourceRegistry` contract.
 */
import type { Document } from './types.js';
import { listDocuments } from './mock-data.js';

/** Tokenises text for the toy similarity model. Lowercase, alpha-only, ≥3 chars. */
function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []);
}

/** Stop-word set used by the toy ranker. Just enough to cut signal noise. */
const STOP = new Set([
  'the', 'and', 'for', 'this', 'that', 'with', 'from', 'have', 'into',
  'about', 'over', 'were', 'are', 'was', 'has', 'had', 'all', 'any',
  'our', 'will', 'their', 'they', 'these', 'those', 'them',
]);

/**
 * Ranked semantic-search result. `score` is a normalised 0..1 value;
 * higher is better. `matched` lists the query terms hit by the doc.
 */
export interface SemanticHit {
  readonly document: Document;
  readonly score: number;
  readonly matched: readonly string[];
}

/**
 * Toy semantic search — computes a tf-style overlap score between the
 * query terms and each document's content + filename + author. Good
 * enough to demo "similar to DOC-1234" prompts; **not** a real model.
 *
 * @remarks
 * The function signature mirrors what a real vector-store data source
 * would expose, so a Phase-5 swap to Vespa / Weaviate is a one-file
 * change inside the `documentIndex` `DataSourceDef`.
 */
export function semanticRank(
  matterId: string,
  query: string,
  opts?: {
    readonly custodianIds?: readonly string[];
    readonly tags?: readonly string[];
    readonly limit?: number;
  },
): readonly SemanticHit[] {
  const queryTerms = new Set(
    tokens(query).filter((t) => !STOP.has(t)),
  );
  if (queryTerms.size === 0) return [];

  const limit = opts?.limit ?? 10;
  const custodianFilter = opts?.custodianIds?.length ? new Set(opts.custodianIds) : null;
  const tagFilter = opts?.tags?.length ? new Set(opts.tags) : null;

  const hits: SemanticHit[] = [];
  for (const doc of listDocuments(matterId)) {
    if (custodianFilter && !custodianFilter.has(doc.custodianId)) continue;
    if (tagFilter && !doc.tags.some((t) => tagFilter.has(t))) continue;

    const haystack = `${doc.fileName} ${doc.contentSnippet} ${doc.authoredBy ?? ''}`;
    const docTerms = tokens(haystack);
    if (docTerms.length === 0) continue;

    let overlap = 0;
    const matched: string[] = [];
    for (const t of queryTerms) {
      const count = docTerms.filter((dt) => dt === t || dt.includes(t)).length;
      if (count > 0) {
        overlap += count;
        matched.push(t);
      }
    }
    if (overlap === 0) continue;

    // Normalise — clamp to [0, 1].
    const tfNorm = Math.min(1, overlap / Math.max(8, docTerms.length / 12));
    const coverageNorm = matched.length / queryTerms.size;
    const score = 0.6 * coverageNorm + 0.4 * tfNorm;
    hits.push({ document: doc, score, matched });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Group documents into a date histogram bucketed by the chosen unit.
 * Returns ordered buckets so a widget can render them left-to-right.
 */
export interface DateBucket {
  readonly key: string;       // e.g. '2025-01' for month buckets
  readonly label: string;     // human-readable
  readonly count: number;
  readonly fromIso: string;
  readonly toIso: string;
}

export function dateHistogram(
  docs: readonly Document[],
  unit: 'month' | 'quarter' | 'year' = 'month',
): readonly DateBucket[] {
  const buckets = new Map<string, { from: Date; to: Date; count: number; label: string }>();
  for (const d of docs) {
    if (!d.authoredAt) continue;
    const dt = new Date(d.authoredAt);
    if (Number.isNaN(dt.getTime())) continue;
    let key: string; let from: Date; let to: Date; let label: string;
    if (unit === 'year') {
      const y = dt.getUTCFullYear();
      key = `${y}`;
      from = new Date(Date.UTC(y, 0, 1));
      to = new Date(Date.UTC(y + 1, 0, 1));
      label = `${y}`;
    } else if (unit === 'quarter') {
      const y = dt.getUTCFullYear();
      const q = Math.floor(dt.getUTCMonth() / 3) + 1;
      key = `${y}-Q${q}`;
      from = new Date(Date.UTC(y, (q - 1) * 3, 1));
      to = new Date(Date.UTC(y, q * 3, 1));
      label = `Q${q} ${y}`;
    } else {
      const y = dt.getUTCFullYear();
      const m = dt.getUTCMonth();
      key = `${y}-${String(m + 1).padStart(2, '0')}`;
      from = new Date(Date.UTC(y, m, 1));
      to = new Date(Date.UTC(y, m + 1, 1));
      label = from.toLocaleString(undefined, { month: 'short', year: 'numeric' });
    }
    const cur = buckets.get(key);
    if (cur) cur.count += 1;
    else buckets.set(key, { from, to, count: 1, label });
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, v]) => ({
      key,
      label: v.label,
      count: v.count,
      fromIso: v.from.toISOString(),
      toIso: v.to.toISOString(),
    }));
}

/**
 * Filter documents to those authored within `[fromIso, toIso)`. Either
 * bound may be omitted for an open interval. Documents missing
 * `authoredAt` are dropped.
 */
export function filterByDateRange(
  docs: readonly Document[],
  fromIso?: string,
  toIso?: string,
): readonly Document[] {
  return docs.filter((d) => {
    if (!d.authoredAt) return false;
    if (fromIso && d.authoredAt < fromIso) return false;
    if (toIso && d.authoredAt >= toIso) return false;
    return true;
  });
}

/**
 * Mock TAR (Technology-Assisted Review) classifier. Returns a
 * confidence score in `[0, 1]` for whether a document is likely
 * responsive to a topic. Real TAR is an iterative active-learning
 * loop; this is a deterministic heuristic for demo purposes.
 */
export interface TARScore {
  readonly documentId: string;
  readonly responsive: number;   // 0..1
  readonly privileged: number;   // 0..1
  readonly hot: number;          // 0..1
  readonly rationale: string;
}

export function classifyDocuments(
  docs: readonly Document[],
  topic: string,
): readonly TARScore[] {
  const topicTerms = tokens(topic).filter((t) => !STOP.has(t));
  return docs.map((d) => {
    const haystack = `${d.fileName} ${d.contentSnippet}`.toLowerCase();
    const overlap = topicTerms.filter((t) => haystack.includes(t)).length;
    const coverage = topicTerms.length === 0 ? 0 : overlap / topicTerms.length;

    // Existing tag signal nudges the score (in real TAR this comes from labelled training data).
    const responsiveTagBoost = d.tags.includes('responsive') ? 0.25 : 0;
    const hotTagBoost = d.tags.includes('hot') ? 0.35 : 0;
    const privTagBoost = d.tags.includes('privileged') ? 0.4 : 0;

    const responsive = Math.min(1, 0.55 * coverage + responsiveTagBoost + 0.15);
    const hot        = Math.min(1, 0.4 * coverage + hotTagBoost);
    const privileged = Math.min(1,
      privTagBoost + (haystack.includes('privileged') || haystack.includes('attorney-client') ? 0.5 : 0));

    const rationale = overlap > 0
      ? `${overlap}/${topicTerms.length} topic term(s) present`
      : 'no topic terms found';
    return { documentId: d.id, responsive, privileged, hot, rationale };
  });
}
