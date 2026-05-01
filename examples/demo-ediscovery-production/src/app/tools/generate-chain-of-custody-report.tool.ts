import { agenticTool } from '@maverick/agentic-ui';
import {
  appendAudit,
  buildChainOfCustodyReport,
  getProductionSet,
  isoNow,
  nextAuditId,
} from '@maverick/demo-ediscovery-shared';
import { z } from 'zod';
import { ACTOR, MATTER_ID } from '../matter-context';

/**
 * Generate the chain-of-custody report for a production set —
 * Phase 5's defensibility primitive. Walks the matter's audit log,
 * filters to events touching this production set's documents and
 * meta, verifies the tamper-evident hash chain, and renders a
 * report widget that legal teams can hand to opposing counsel.
 *
 * @remarks
 * The report itself becomes an audit event so the act of generating
 * it is part of the chain. Phase 6's MCP integration exposes this
 * same tool to Claude Desktop so paralegals can run the report
 * outside the web app.
 */
export const generateChainOfCustodyReportTool = agenticTool({
  name: 'generateChainOfCustodyReport',
  description:
    'Build a chain-of-custody report for a production set. Lists every ' +
    'audit event touching that set or its documents in chronological ' +
    'order, with a tamper-evident hash on each line. Use after ' +
    "`exportProductionSet` so the report covers the full lifecycle. " +
    'Required for any production hand-off where the receiving party ' +
    'will challenge integrity.',
  schema: z.object({
    productionId: z.string().describe("Production-set id, e.g. 'PROD-A1B2'"),
  }),
  handler: async ({ productionId }) => {
    const set = getProductionSet(productionId);
    if (!set) {
      return {
        error: `Unknown production set: ${productionId}`,
        markdown: `⚠️ No production set with id \`${productionId}\`.`,
      };
    }

    const generatedAt = isoNow();
    const report = buildChainOfCustodyReport(MATTER_ID, set, generatedAt);

    appendAudit({
      id: nextAuditId(),
      matterId: MATTER_ID,
      timestamp: generatedAt,
      actor: ACTOR,
      action: 'production.chain-of-custody.generated',
      target: { type: 'production-set', id: productionId },
      after: {
        lineCount: report.lines.length,
        chainVerified: report.summary.chainVerified,
      },
    });

    return {
      productionId,
      generatedAt,
      summary: report.summary,
      lineCount: report.lines.length,
      components: [{
        name: 'chainOfCustodyReport',
        props: {
          title: report.title,
          productionId,
          generatedAt,
          chainVerified: report.summary.chainVerified,
          chainHead: report.chain.head ?? '—',
          chainEvents: report.chain.events,
          chainBroken: report.chain.broken.length,
          documentCount: report.summary.documentCount,
          totalRedactions: report.summary.totalRedactions,
          lines: report.lines.map((l) => ({
            timestamp: l.timestamp,
            actor: l.actor,
            action: l.action,
            targetType: l.target.type,
            targetId: l.target.id,
            reason: l.reason ?? null,
            chainHash: l.chainHash ?? null,
            verified: l.verified,
          })),
        },
      }],
      markdown:
        `**Chain-of-custody report** — ${report.title}\n\n` +
        `| Documents | ${report.summary.documentCount} |\n|---|---|\n` +
        `| Redactions | ${report.summary.totalRedactions} |\n` +
        `| Audit events covered | ${report.summary.auditEventsRelevant} of ${report.summary.auditEventsTotal} |\n` +
        `| Chain integrity | ${report.summary.chainVerified ? '✅ verified' : '⚠️ broken'} |\n` +
        `| Chain head | \`${report.chain.head ?? '—'}\` |\n\n` +
        (report.summary.chainVerified
          ? '_All hashes recompute correctly — the trail is defensible._'
          : `_⚠️ ${report.chain.broken.length} hash break(s) detected — investigate before delivery._`),
    };
  },
});
