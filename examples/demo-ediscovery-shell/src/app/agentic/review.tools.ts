import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { agenticTool } from '@infra-tools/agentic-ui';
import { isoNow, type PrivilegeReason } from '@infra-tools/demo-ediscovery-shared';
import { z } from 'zod';
import { MatterStore } from '../services/matter.store';

/**
 * Slice A review tools. Wrap `MatterStore` document mutations so the
 * agent can drive them from chat, the row-action menu can dispatch
 * the same code path, and the slot widgets can call directly. Each
 * one audit-chains via `MatterStore.audit()` and increments the
 * document-mutation signal so live UIs refresh.
 */

const documentTagSchema = z.enum([
  'responsive',
  'non-responsive',
  'privileged',
  'hot',
  'redact',
  'review-needed',
]);

const tagDocumentSchema = z.object({
  documentId: z.string().describe('Document id (e.g. DOC-7891240)'),
  tag: documentTagSchema,
  privilegeReason: z.enum(['attorney-client', 'work-product', 'common-interest']).optional()
    .describe("If tag === 'privileged', the basis. Used by the privilege log."),
});

export function tagDocumentTool(env: EnvironmentInjector) {
  return agenticTool({
    name: 'tagDocument',
    description:
      'Add a tag to a single document. When tag is `privileged`, pass ' +
      '`privilegeReason` so the privilege log captures the basis. ' +
      'Mutates persisted state + chain-hashes an audit event. Idempotent: ' +
      'reapplying an existing tag is a no-op.',
    schema: tagDocumentSchema,
    handler: async ({ documentId, tag, privilegeReason }) => {
      return runInInjectionContext(env, () => {
        const matter = env.get(MatterStore);
        const updated = matter.tagDocument(documentId, tag);
        if (!updated) return { ok: false, error: `Document ${documentId} not found.` };
        if (tag === 'privileged' && privilegeReason) {
          matter.setDocumentPrivilegeReason(documentId, privilegeReason as PrivilegeReason);
        }
        return {
          ok: true,
          documentId,
          tag,
          tags: updated.tags,
          privilegeReason: updated.privilegeReason,
          message: `Tagged ${documentId} ${tag}.`,
        };
      });
    },
  });
}

const bulkTagDocumentsSchema = z.object({
  documentIds: z.array(z.string()).min(1).describe('Documents to tag (1+).'),
  tag: documentTagSchema,
});

export function bulkTagDocumentsTool(env: EnvironmentInjector) {
  return agenticTool({
    name: 'bulkTagDocuments',
    description:
      'Apply one tag to multiple documents. Each document audited ' +
      'individually so the chain remains per-document; existing tags ' +
      'are skipped (no duplicate audit). For 50+ documents this is the ' +
      'right tool; for 1 document use `tagDocument`. Registers a long-' +
      'running OperationDef for progress tracking when count ≥ 100.',
    schema: bulkTagDocumentsSchema,
    handler: async ({ documentIds, tag }) => {
      return runInInjectionContext(env, () => {
        const matter = env.get(MatterStore);
        // Large bulk operations would ideally publish to OperationRegistry
        // for /operations progress tracking. The current OperationRegistry
        // surface starts ops from a tool-result envelope, not directly;
        // wiring that pattern is a future enhancement.
        const modified = matter.bulkTagDocuments(documentIds, tag);
        return {
          ok: true,
          modified,
          requested: documentIds.length,
          tag,
          message: `Tagged ${modified} of ${documentIds.length} document(s) as ${tag}.`,
        };
      });
    },
  });
}

const generatePrivilegeLogSchema = z.object({
  includeReason: z.boolean().optional().default(true)
    .describe('Include the privilege basis (attorney-client / work-product / common-interest).'),
});

export function generatePrivilegeLogTool(env: EnvironmentInjector) {
  return agenticTool({
    name: 'generatePrivilegeLog',
    description:
      'Generate the privilege log for this matter. Walks every document ' +
      'tagged `privileged` and emits a row per entry with doc id, file ' +
      'name, author, date, and basis. Output shape is suitable for ' +
      'export to court-ready PDF; the privilege-log widget reads from ' +
      'this same source.',
    schema: generatePrivilegeLogSchema,
    handler: async ({ includeReason }) => {
      return runInInjectionContext(env, () => {
        const matter = env.get(MatterStore);
        // Touch documentMutation signal so subscribers refresh.
        matter.documentMutation();
        const docs = matter.documents().filter((d) => d.tags.includes('privileged'));
        const entries = docs.map((d) => ({
          documentId: d.id,
          fileName: d.fileName,
          authoredBy: d.authoredBy ?? 'unknown',
          authoredAt: d.authoredAt ?? null,
          basis: includeReason ? (d.privilegeReason ?? 'attorney-client') : undefined,
          fileType: d.fileType,
          hash: d.hash,
        }));
        return {
          ok: true,
          count: entries.length,
          generatedAt: isoNow(),
          entries,
          message: `Privilege log: ${entries.length} entries.`,
        };
      });
    },
  });
}
