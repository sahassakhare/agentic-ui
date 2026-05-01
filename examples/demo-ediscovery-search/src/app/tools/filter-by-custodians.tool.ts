import { agenticTool } from '@maverick/agentic-ui';
import { listCustodians } from '@maverick/demo-ediscovery-shared';
import { z } from 'zod';
import { MATTER_ID } from '../matter-context';

/**
 * Resolve a name list (or department) to custodian ids, then return
 * the docs scoped to those custodians. Acts as a hand-off to
 * `semanticSearch` / `filterByDateRange` / `runTARClassifier` —
 * stops the agent from guessing custodian ids.
 */
export const filterByCustodiansTool = agenticTool({
  name: 'filterByCustodians',
  description:
    'Resolve custodian names or departments to canonical CUST-ids. ' +
    'Call this first when the user mentions people by name ("Sarah Chen") ' +
    'or by team ("Engineering"). Returns ids the other search tools accept.',
  schema: z.object({
    names: z.array(z.string()).optional().describe('Substring match against custodian names'),
    departments: z.array(z.string()).optional().describe('Exact-match department filter'),
    onlyOnHold: z.boolean().optional().describe('Restrict to custodians under an active legal hold'),
  }),
  handler: async ({ names, departments, onlyOnHold }) => {
    let matches = listCustodians(MATTER_ID);
    if (names?.length) {
      const lower = names.map((n) => n.toLowerCase());
      matches = matches.filter((c) =>
        lower.some((n) => c.name.toLowerCase().includes(n))
      );
    }
    if (departments?.length) {
      const lower = departments.map((d) => d.toLowerCase());
      matches = matches.filter((c) => lower.includes(c.department.toLowerCase()));
    }
    if (onlyOnHold) {
      matches = matches.filter((c) => c.hasLegalHold);
    }
    return {
      count: matches.length,
      custodianIds: matches.map((c) => c.id),
      custodians: matches.map((c) => ({
        id: c.id,
        name: c.name,
        department: c.department,
        documentCount: c.documentCount,
        hasLegalHold: c.hasLegalHold,
      })),
      markdown:
        `Resolved **${matches.length}** custodian(s):\n\n` +
        (matches.length === 0
          ? '_No matches. Try \`listCustodians\` to see who is on the matter._'
          : matches.map((c) =>
              `- \`${c.id}\` — **${c.name}** (${c.department})` +
              `${c.hasLegalHold ? ' · on hold' : ''} · ${c.documentCount} docs`
            ).join('\n')) +
        `\n\nPass these ids as \`custodianIds\` to \`semanticSearch\`, \`filterByDateRange\`, or \`runTARClassifier\`.`,
    };
  },
});
