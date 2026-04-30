import { agenticTool } from '@maverick/agentic-ui';
import {
  appendAudit,
  getDocument,
  isoNow,
  listDocuments,
  nextAuditId,
} from '@maverick/demo-ediscovery-shared';
import { z } from 'zod';
import { ACTOR, MATTER_ID } from '../matter-context';

/**
 * Snapshot the current set of privileged documents into the audit log
 * as a privilege-log entry. The audit log is the source of truth Phase 5
 * builds the chain-of-custody report from; this tool gives the agent
 * an explicit "log this state" hook for production-prep workflows.
 */
export const addToPrivilegeLogTool = agenticTool({
  name: 'addToPrivilegeLog',
  description:
    'Append a privilege-log entry to the audit trail summarising every ' +
    'currently-privileged document in the matter (or just one, if a documentId ' +
    'is given). Use after a privilege-review pass before generating a ' +
    'production set so the log reflects the final review state.',
  schema: z.object({
    documentId: z.string().optional().describe('Single document to log; omit to log all currently-privileged docs'),
    summary: z.string().min(5).describe('Brief summary that goes in the audit entry — what was reviewed, by whom, on what basis'),
  }),
  handler: async ({ documentId, summary }) => {
    const candidates = documentId
      ? [getDocument(documentId)].filter((d): d is NonNullable<typeof d> => Boolean(d))
      : listDocuments(MATTER_ID).filter((d) => d.privilegeReason);

    if (candidates.length === 0) {
      return {
        markdown: documentId
          ? `⚠️ Document \`${documentId}\` not found.`
          : 'No privileged documents on this matter yet — nothing to log.',
        count: 0,
      };
    }

    const entry = {
      summary,
      documents: candidates.map((d) => ({
        id: d.id,
        fileName: d.fileName,
        custodianId: d.custodianId,
        privilegeReason: d.privilegeReason ?? 'unspecified',
      })),
    };

    appendAudit({
      id: nextAuditId(),
      matterId: MATTER_ID,
      timestamp: isoNow(),
      actor: ACTOR,
      action: 'privilege-log.entry.added',
      target: documentId
        ? { type: 'document', id: documentId }
        : { type: 'matter', id: MATTER_ID },
      after: entry,
      reason: summary,
    });

    return {
      ...entry,
      count: candidates.length,
      markdown:
        `**Privilege-log entry added** — ${candidates.length} document(s)\n\n` +
        candidates.map((d) => `- \`${d.id}\` — ${d.fileName} (${d.privilegeReason ?? 'unspecified'})`).join('\n') +
        `\n\n> ${summary}`,
    };
  },
});
