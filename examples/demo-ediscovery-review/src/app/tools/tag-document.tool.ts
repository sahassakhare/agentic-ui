import { agenticTool } from '@maverick/agentic-ui';
import {
  appendAudit,
  getDocument,
  isoNow,
  nextAuditId,
  updateDocument,
} from '@maverick/demo-ediscovery-shared';
import { z } from 'zod';
import { ACTOR, MATTER_ID } from '../matter-context';

const TAG_VALUES = ['responsive', 'non-responsive', 'privileged', 'hot', 'redact', 'review-needed'] as const;

/**
 * Apply or remove tags on a document. Tags drive review workflows
 * (responsive/non-responsive triage), privilege flagging, and
 * production-set inclusion. Each call appends an audit event so the
 * chain-of-custody report (Phase 5) can reconstruct who tagged what.
 */
export const tagDocumentTool = agenticTool({
  name: 'tagDocument',
  description:
    'Apply (default) or remove tags on a document. Common tags: ' +
    'responsive, non-responsive, privileged, hot (high-importance), ' +
    'redact (needs redaction before production), review-needed. ' +
    'Always include the document id from `searchDocuments` rather than guessing.',
  schema: z.object({
    documentId: z.string().describe("Document id, e.g. 'DOC-7891234'"),
    tags: z.array(z.enum(TAG_VALUES)).min(1).describe('Tags to apply or remove'),
    operation: z.enum(['add', 'remove']).optional().describe("Default 'add'"),
  }),
  handler: async ({ documentId, tags, operation }) => {
    const op = operation ?? 'add';
    const doc = getDocument(documentId);
    if (!doc) {
      return {
        error: `Unknown document: ${documentId}`,
        markdown: `⚠️ No document with id \`${documentId}\`. Try \`searchDocuments\` first.`,
      };
    }
    const before = [...doc.tags];
    const next = op === 'add'
      ? Array.from(new Set([...doc.tags, ...tags]))
      : doc.tags.filter((t) => !tags.includes(t));
    const updated = updateDocument(documentId, { tags: next as readonly typeof TAG_VALUES[number][] });
    appendAudit({
      id: nextAuditId(),
      matterId: MATTER_ID,
      timestamp: isoNow(),
      actor: ACTOR,
      action: op === 'add' ? 'document.tag.added' : 'document.tag.removed',
      target: { type: 'document', id: documentId },
      before: { tags: before },
      after: { tags: next },
    });
    return {
      documentId,
      operation: op,
      tags: next,
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
          privilegeReason: updated!.privilegeReason ?? null,
        },
      }],
      markdown:
        `**${op === 'add' ? 'Tags added' : 'Tags removed'}** on \`${documentId}\`: ` +
        tags.map((t) => `\`${t}\``).join(', ') +
        `\n\nCurrent tags: ${next.length === 0 ? '_(none)_' : next.map((t) => `\`${t}\``).join(', ')}`,
    };
  },
});
