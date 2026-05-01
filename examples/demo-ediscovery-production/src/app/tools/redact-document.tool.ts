import { agenticTool } from '@maverick/agentic-ui';
import {
  appendAudit,
  getDocument,
  isoNow,
  nextAuditId,
  updateDocument,
  type RedactionSpan,
} from '@maverick/demo-ediscovery-shared';
import { z } from 'zod';
import { ACTOR, MATTER_ID } from '../matter-context';

const REASONS = ['pii', 'privilege', 'confidential'] as const;

/**
 * Apply a redaction span to a document. Each span carries page +
 * bounding box + reason + actor + timestamp — the substrate for
 * Phase 5's chain-of-custody report. Multiple redactions accumulate
 * on the same document; the order matters for the audit trail.
 */
export const redactDocumentTool = agenticTool({
  name: 'redactDocument',
  description:
    'Apply a redaction span to a document. Each span has a page number and a ' +
    'bounding box (x, y, width, height in document points). Reason categorises ' +
    'the redaction (pii / privilege / confidential) — drives the production-set ' +
    'cover sheet and chain-of-custody report. Multiple spans can be applied to ' +
    'the same document; order matters for the audit log.',
  schema: z.object({
    documentId: z.string().describe("Document id, e.g. 'DOC-7891234'"),
    page: z.number().int().min(1).describe('1-indexed page number'),
    bbox: z.tuple([
      z.number().describe('x (points)'),
      z.number().describe('y (points)'),
      z.number().describe('width (points)'),
      z.number().describe('height (points)'),
    ]).describe('Bounding box: [x, y, width, height] in document points'),
    reason: z.enum(REASONS).describe('Reason category'),
    note: z.string().optional().describe('Optional reviewer note for the audit log'),
  }),
  handler: async ({ documentId, page, bbox, reason, note }) => {
    const doc = getDocument(documentId);
    if (!doc) {
      return {
        error: `Unknown document: ${documentId}`,
        markdown: `⚠️ No document with id \`${documentId}\`. Search first via \`searchDocuments\`.`,
      };
    }

    const span: RedactionSpan = {
      page,
      bbox: bbox as readonly [number, number, number, number],
      reason,
      appliedBy: ACTOR,
      appliedAt: isoNow(),
    };
    const next = [...doc.redactions, span];
    const tagsNext = doc.tags.includes('redact') ? doc.tags : ([...doc.tags, 'redact'] as readonly typeof doc.tags[number][]);
    const updated = updateDocument(documentId, { redactions: next, tags: tagsNext });

    appendAudit({
      id: nextAuditId(),
      matterId: MATTER_ID,
      timestamp: isoNow(),
      actor: ACTOR,
      action: 'document.redacted',
      target: { type: 'document', id: documentId },
      after: { page, bbox, reason, redactionCount: next.length },
      reason: note,
    });

    return {
      documentId,
      page,
      reason,
      redactionCount: next.length,
      components: [{
        name: 'redactionEditor',
        props: {
          documentId,
          fileName: updated!.fileName,
          page,
          bbox,
          reason,
          allRedactions: next.map((r) => ({ page: r.page, bbox: [...r.bbox] as [number, number, number, number], reason: r.reason })),
        },
      }],
      markdown:
        `**Redaction applied** — \`${documentId}\` (page ${page}, ${reason})\n\n` +
        `Bounding box: [${bbox.join(', ')}]\n\n` +
        `Document now carries **${next.length}** redaction(s).` +
        (note ? `\n\n> ${note}` : ''),
    };
  },
});
