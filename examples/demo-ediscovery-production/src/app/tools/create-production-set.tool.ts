import { agenticTool } from '@maverick/agentic-ui';
import {
  addProductionSet,
  appendAudit,
  isoNow,
  listDocuments,
  nextAuditId,
  nextProductionSetId,
  validateBatesPattern,
  type ProductionSet,
} from '@maverick/demo-ediscovery-shared';
import { z } from 'zod';
import { ACTOR, MATTER_ID } from '../matter-context';

const FORMATS = ['native', 'tiff', 'pdf', 'load-file'] as const;

/**
 * Create a draft production set. The agent's first step in the
 * `create → assign-bates → export` chain. Validates the Bates
 * pattern *before* creating the set so a malformed pattern fails
 * loudly rather than corrupting the audit trail.
 */
export const createProductionSetTool = agenticTool({
  name: 'createProductionSet',
  description:
    'Create a new draft production set. Filters: scope by tag (e.g. "responsive"), ' +
    'exclude privileged docs (default true), optional date range. The Bates pattern ' +
    "uses Python format syntax — e.g. 'ACME-{seq:07d}' for seven-digit zero-padded numbers. " +
    'Production starts in `draft` status; finalise via `exportProductionSet` after Bates assignment.',
  schema: z.object({
    name: z.string().min(3).describe("Set name, e.g. 'PROD-002 — Q1 2025 responsive set'"),
    format: z.enum(FORMATS).describe('Delivery format'),
    batesPattern: z.string().describe("Bates pattern with {seq:Nd} placeholder, e.g. 'ACME-{seq:07d}'"),
    scope: z.object({
      includeTags: z.array(z.string()).optional().describe("Include only these tags (default: ['responsive'])"),
      excludePrivileged: z.boolean().optional().describe('Drop privileged docs (default true)'),
      authoredAfter: z.string().optional().describe('ISO date — drop docs authored before'),
      authoredBefore: z.string().optional().describe('ISO date — drop docs authored after'),
    }).describe('Filters that pick which documents the set covers'),
  }),
  handler: async ({ name, format, batesPattern, scope }) => {
    const validation = validateBatesPattern(batesPattern);
    if (!validation.ok) {
      return {
        error: 'Invalid Bates pattern',
        pattern: batesPattern,
        problems: validation.errors,
        markdown:
          `⚠️ Bates pattern \`${batesPattern}\` is invalid:\n` +
          validation.errors.map((e) => `- ${e}`).join('\n') +
          `\n\nTry \`ACME-{seq:07d}\` for a seven-digit zero-padded sequence.`,
      };
    }

    const includeTags = scope.includeTags?.length ? scope.includeTags : ['responsive'];
    const excludePrivileged = scope.excludePrivileged ?? true;
    const docs = listDocuments(MATTER_ID).filter((d) => {
      if (!d.tags.some((t) => includeTags.includes(t))) return false;
      if (excludePrivileged && d.privilegeReason) return false;
      if (scope.authoredAfter && d.authoredAt && d.authoredAt < scope.authoredAfter) return false;
      if (scope.authoredBefore && d.authoredAt && d.authoredAt > scope.authoredBefore) return false;
      return true;
    });

    const set: ProductionSet = {
      id: nextProductionSetId(),
      matterId: MATTER_ID,
      name,
      format,
      batesPattern,
      documents: docs.map((d) => d.id),
      status: 'draft',
      createdAt: isoNow(),
    };
    addProductionSet(set);

    appendAudit({
      id: nextAuditId(),
      matterId: MATTER_ID,
      timestamp: isoNow(),
      actor: ACTOR,
      action: 'production.created',
      target: { type: 'production-set', id: set.id },
      after: { name, format, batesPattern, documentCount: docs.length, scope },
    });

    return {
      ...set,
      documentCount: docs.length,
      components: [{
        name: 'productionSummary',
        props: {
          productionId: set.id,
          name: set.name,
          format: set.format,
          batesPattern: set.batesPattern,
          documentCount: docs.length,
          status: set.status,
          createdAt: set.createdAt,
        },
      }],
      markdown:
        `**Production set created** — \`${set.id}\`\n\n` +
        `| Name | ${name} |\n|---|---|\n` +
        `| Format | ${format} |\n` +
        `| Bates pattern | \`${batesPattern}\` |\n` +
        `| Documents | ${docs.length} (${includeTags.join('/')}${excludePrivileged ? ', non-privileged' : ''}) |\n\n` +
        `Next step: call \`assignBatesNumbers\` with id \`${set.id}\`.`,
    };
  },
});
