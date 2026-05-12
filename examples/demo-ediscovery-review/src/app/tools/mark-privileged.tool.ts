import { agenticTool } from '@infra-tools/agentic-ui';
import {
  appendAudit,
  getDocument,
  isoNow,
  nextAuditId,
  updateDocument,
} from '@infra-tools/demo-ediscovery-shared';
import { z } from 'zod';
import { ACTOR, MATTER_ID } from '../matter-context';

const PRIVILEGE_REASONS = ['attorney-client', 'work-product', 'common-interest'] as const;

/**
 * Flag a document as privileged. Sets `privilegeReason` (used in the
 * privilege log) and ensures the `privileged` tag is applied so review
 * filters and production-set scope queries pick it up.
 */
export const markPrivilegedTool = agenticTool({
  name: 'markPrivileged',
  description:
    'Mark a document as privileged with a specific reason. The reason ' +
    'becomes the privilege-log entry and surfaces in productions. Common ' +
    'reasons: attorney-client (advice between counsel and client), ' +
    'work-product (counsel preparing for litigation), common-interest ' +
    '(shared between aligned counsel). Always confirm the reason matches ' +
    'the document content before calling.',
  schema: z.object({
    documentId: z.string().describe("Document id, e.g. 'DOC-7891234'"),
    reason: z.enum(PRIVILEGE_REASONS).describe('Privilege basis'),
    note: z.string().optional().describe('Optional reviewer note for the privilege log'),
  }),
  handler: async ({ documentId, reason, note }) => {
    const doc = getDocument(documentId);
    if (!doc) {
      return {
        error: `Unknown document: ${documentId}`,
        markdown: `⚠️ No document with id \`${documentId}\`. Try \`searchDocuments\` first.`,
      };
    }
    const before = { tags: [...doc.tags], privilegeReason: doc.privilegeReason };
    const nextTags = doc.tags.includes('privileged') ? doc.tags : ([...doc.tags, 'privileged'] as readonly typeof doc.tags[number][]);
    const updated = updateDocument(documentId, { tags: nextTags, privilegeReason: reason });
    appendAudit({
      id: nextAuditId(),
      matterId: MATTER_ID,
      timestamp: isoNow(),
      actor: ACTOR,
      action: 'document.marked-privileged',
      target: { type: 'document', id: documentId },
      before,
      after: { tags: updated!.tags, privilegeReason: reason },
      reason: note,
    });
    return {
      documentId,
      privilegeReason: reason,
      components: [{
        name: 'documentPreview',
        props: {
          documentId: updated!.id,
          fileName: updated!.fileName,
          custodianId: updated!.custodianId,
          authoredBy: updated!.authoredBy ?? '—',
          authoredAt: updated!.authoredAt ?? '—',
          contentSnippet: updated!.contentSnippet,
          tags: [...updated!.tags],
          privilegeReason: reason,
        },
      }],
      markdown:
        `**Marked privileged** — \`${documentId}\` (${reason})` +
        (note ? `\n\n> ${note}` : ''),
    };
  },
});
