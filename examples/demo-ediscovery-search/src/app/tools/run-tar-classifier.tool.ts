import { agenticTool } from '@maverick/agentic-ui';
import {
  appendAudit,
  isoNow,
  nextAuditId,
  type TARScore,
} from '@maverick/demo-ediscovery-shared';
import { z } from 'zod';
import { documentIndexDataSource, type IndexQuery, type IndexResult } from '../data-sources/document-index.data-source';
import { ACTOR, MATTER_ID } from '../matter-context';

/**
 * Run a (mock) TAR classifier across the un-tagged document set —
 * scores each document for responsiveness, privilege, and "hot"
 * importance against a topic. The result is a sortable table the
 * agent or user reviews; nothing is auto-tagged.
 *
 * @remarks
 * Real TAR is an iterative active-learning loop with reviewer
 * feedback. The mock here is deterministic so demos are repeatable;
 * the swap-in is a one-file change inside the data source.
 */
export const runTARClassifierTool = agenticTool({
  name: 'runTARClassifier',
  description:
    'Score un-tagged documents against a topic using TAR (Technology- ' +
    'Assisted Review). Returns per-document confidence for `responsive`, ' +
    '`privileged`, and `hot`. Use to prioritise the next slice of review. ' +
    'Always set `onlyUntagged: true` unless the user wants to re-score.',
  schema: z.object({
    topic: z.string().min(3).describe("Topic to classify against (e.g. 'Project Phoenix')"),
    onlyUntagged: z.boolean().optional().describe('Default true — skip already-tagged docs'),
    custodianIds: z.array(z.string()).optional().describe('Restrict to specific custodians'),
    threshold: z.number().min(0).max(1).optional().describe('Hide scores below this (default 0.3)'),
  }),
  handler: async ({ topic, onlyUntagged, custodianIds, threshold }) => {
    const onlyU = onlyUntagged ?? true;
    const cutoff = threshold ?? 0.3;
    const query: IndexQuery = { op: 'classify', topic, onlyUntagged: onlyU, custodianIds };
    const result = await documentIndexDataSource.adapter(query) as IndexResult;
    const scores = result.kind === 'classify' ? result.scores : [];
    const above = scores
      .filter((s) => s.responsive >= cutoff || s.privileged >= cutoff || s.hot >= cutoff)
      .sort((a, b) => Math.max(b.responsive, b.privileged, b.hot)
                    - Math.max(a.responsive, a.privileged, a.hot));

    appendAudit({
      id: nextAuditId(),
      matterId: MATTER_ID,
      timestamp: isoNow(),
      actor: ACTOR,
      action: 'tar.classified',
      target: { type: 'matter', id: MATTER_ID },
      after: {
        topic,
        scored: scores.length,
        aboveThreshold: above.length,
        threshold: cutoff,
      },
    });

    const fmt = (s: TARScore) =>
      `\`${s.documentId}\` · resp \`${s.responsive.toFixed(2)}\` · ` +
      `priv \`${s.privileged.toFixed(2)}\` · hot \`${s.hot.toFixed(2)}\` · _${s.rationale}_`;

    return {
      topic,
      scored: scores.length,
      aboveThreshold: above.length,
      threshold: cutoff,
      scores: above.slice(0, 25).map((s) => ({
        documentId: s.documentId,
        responsive: Number(s.responsive.toFixed(3)),
        privileged: Number(s.privileged.toFixed(3)),
        hot: Number(s.hot.toFixed(3)),
        rationale: s.rationale,
      })),
      components: above.length === 0 ? [] : [{
        name: 'tarScores',
        props: {
          topic,
          threshold: cutoff,
          scored: scores.length,
          rows: above.slice(0, 12).map((s) => ({
            documentId: s.documentId,
            responsive: Number(s.responsive.toFixed(3)),
            privileged: Number(s.privileged.toFixed(3)),
            hot: Number(s.hot.toFixed(3)),
            rationale: s.rationale,
          })),
        },
      }],
      markdown:
        `**TAR run** — topic "${topic}" · scored **${scores.length}** doc(s) ` +
        `· **${above.length}** above threshold \`${cutoff}\`\n\n` +
        (above.length === 0
          ? '_No documents scored above the threshold._'
          : above.slice(0, 6).map(fmt).join('\n')),
    };
  },
});
