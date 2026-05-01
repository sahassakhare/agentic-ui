import { agenticTool } from '@maverick/agentic-ui';
import {
  appendAudit,
  generateBatesRange,
  getProductionSet,
  isoNow,
  nextAuditId,
  updateDocument,
  updateProductionSet,
  validateBatesPattern,
} from '@maverick/demo-ediscovery-shared';
import { z } from 'zod';
import { ACTOR, MATTER_ID } from '../matter-context';

/**
 * Assign Bates numbers to every document in a draft production set.
 * Step 2 of the production chain — must follow `createProductionSet`.
 *
 * @remarks
 * Stamps Bates ids on the underlying `Document.bates` field too, so
 * the Documents page and review widgets surface them. Idempotent:
 * re-assigning overwrites previous ids (production-as-draft is
 * fluid until export finalises).
 */
export const assignBatesNumbersTool = agenticTool({
  name: 'assignBatesNumbers',
  description:
    'Assign sequential Bates numbers to every document in a draft production set. ' +
    'Pattern comes from the set; sequence starts at `start` (default 1). Run after ' +
    '`createProductionSet`. The set status moves to `review` once Bates ids are stamped.',
  schema: z.object({
    productionId: z.string().describe("Production-set id, e.g. 'PROD-A1B2'"),
    start: z.number().int().min(1).optional().describe('First sequence number (default 1)'),
  }),
  handler: async ({ productionId, start }) => {
    const set = getProductionSet(productionId);
    if (!set) {
      return {
        error: `Unknown production set: ${productionId}`,
        markdown: `⚠️ No production set with id \`${productionId}\`. Try \`createProductionSet\` first.`,
      };
    }
    if (set.status !== 'draft') {
      return {
        error: `Production set is in status '${set.status}'`,
        markdown: `⚠️ Bates can only be assigned on draft sets — \`${productionId}\` is **${set.status}**.`,
      };
    }
    const validation = validateBatesPattern(set.batesPattern);
    if (!validation.ok) {
      return {
        error: 'Invalid Bates pattern on set',
        problems: validation.errors,
        markdown: `⚠️ Set's Bates pattern \`${set.batesPattern}\` no longer validates. Recreate the set.`,
      };
    }

    const seq = start ?? 1;
    const ids = generateBatesRange(set.batesPattern, seq, set.documents.length);

    set.documents.forEach((docId, i) => {
      updateDocument(docId, { bates: ids[i]!, productionSet: set.id });
    });

    const updated = updateProductionSet(productionId, { status: 'review' });

    appendAudit({
      id: nextAuditId(),
      matterId: MATTER_ID,
      timestamp: isoNow(),
      actor: ACTOR,
      action: 'production.bates-assigned',
      target: { type: 'production-set', id: productionId },
      after: { range: ids.length === 0 ? null : { from: ids[0], to: ids[ids.length - 1] }, count: ids.length },
    });

    return {
      productionId,
      count: ids.length,
      first: ids[0] ?? null,
      last: ids[ids.length - 1] ?? null,
      components: [{
        name: 'batesPreview',
        props: {
          productionId,
          pattern: set.batesPattern,
          first: ids[0] ?? '',
          last: ids[ids.length - 1] ?? '',
          count: ids.length,
          sample: ids.slice(0, 3),
        },
      }, {
        name: 'productionSummary',
        props: {
          productionId,
          name: updated!.name,
          format: updated!.format,
          batesPattern: updated!.batesPattern,
          documentCount: updated!.documents.length,
          status: updated!.status,
          createdAt: updated!.createdAt,
        },
      }],
      markdown:
        `**Bates numbers assigned** — \`${productionId}\`\n\n` +
        `Range \`${ids[0] ?? '—'}\` → \`${ids[ids.length - 1] ?? '—'}\` (${ids.length} ids)\n\n` +
        `Set is now in **review** status. Finalise with \`exportProductionSet\`.`,
    };
  },
});
