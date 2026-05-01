import { agenticTool } from '@maverick/agentic-ui';
import {
  appendAudit,
  getProductionSet,
  isoNow,
  listDocuments,
  nextAuditId,
  updateProductionSet,
} from '@maverick/demo-ediscovery-shared';
import { z } from 'zod';
import { ACTOR, MATTER_ID } from '../matter-context';

/**
 * Finalise and "export" a production set — the third step in the
 * production chain. Status moves `review → finalized → delivered`
 * depending on `deliver`. After finalisation, Bates ids and the
 * document set are immutable; further changes require a new set.
 *
 * @remarks
 * Real eDiscovery vendors stream the actual TIFF/PDF/load-file bundle
 * to opposing counsel here. The demo logs the action and returns a
 * production summary; the visible side-effect is the status flip plus
 * an audit entry that the chain-of-custody report consumes.
 */
export const exportProductionSetTool = agenticTool({
  name: 'exportProductionSet',
  description:
    'Finalise a reviewed production set. Status moves from `review` to `finalized`. ' +
    'Pass `deliver: true` to also mark it as `delivered` (the final state — ' +
    'Bates ids, document list, and redactions become immutable). ' +
    'Always confirm the reason with the user before delivery — this is the audit hand-off.',
  schema: z.object({
    productionId: z.string().describe("Production-set id, e.g. 'PROD-A1B2'"),
    deliver: z.boolean().optional().describe('Move to `delivered` (default false — finalize only)'),
    reason: z.string().min(5).describe('User-provided justification for the audit trail'),
  }),
  handler: async ({ productionId, deliver, reason }) => {
    const set = getProductionSet(productionId);
    if (!set) {
      return {
        error: `Unknown production set: ${productionId}`,
        markdown: `⚠️ No production set with id \`${productionId}\`.`,
      };
    }
    if (set.status === 'draft') {
      return {
        error: 'Bates ids not yet assigned',
        markdown:
          `⚠️ Set \`${productionId}\` is still in **draft**. Run \`assignBatesNumbers\` first ` +
          'so each document carries an immutable Bates id before delivery.',
      };
    }
    if (set.status === 'delivered') {
      return {
        error: 'Already delivered',
        markdown: `ℹ️ Set \`${productionId}\` was already delivered at ${set.finalisedAt}.`,
      };
    }

    const targetStatus = deliver ? 'delivered' as const : 'finalized' as const;
    const updated = updateProductionSet(productionId, {
      status: targetStatus,
      finalisedAt: isoNow(),
    });

    appendAudit({
      id: nextAuditId(),
      matterId: MATTER_ID,
      timestamp: isoNow(),
      actor: ACTOR,
      action: deliver ? 'production.delivered' : 'production.finalized',
      target: { type: 'production-set', id: productionId },
      after: { status: targetStatus, documentCount: set.documents.length },
      reason,
    });

    const docs = listDocuments(MATTER_ID).filter((d) => set.documents.includes(d.id));
    const totalRedactions = docs.reduce((n, d) => n + d.redactions.length, 0);

    return {
      ...updated!,
      documentCount: set.documents.length,
      totalRedactions,
      components: [{
        name: 'productionSummary',
        props: {
          productionId,
          name: updated!.name,
          format: updated!.format,
          batesPattern: updated!.batesPattern,
          documentCount: set.documents.length,
          status: updated!.status,
          createdAt: updated!.createdAt,
        },
      }],
      markdown:
        `**Production ${deliver ? 'delivered' : 'finalised'}** — \`${productionId}\`\n\n` +
        `| Documents | ${set.documents.length} |\n|---|---|\n` +
        `| Redactions | ${totalRedactions} |\n` +
        `| Status | \`${targetStatus}\` |\n` +
        `| Format | ${set.format} |\n\n` +
        `> ${reason}`,
    };
  },
});
