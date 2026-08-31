/**
 * The copilot's **authoring tools** — the client-side tools the LLM calls to
 * draft governed capabilities in the Studio. They run in the browser (agenticTool
 * defaults `executeIn:'host'`), delegate to `authoringBridge` (populated by the
 * copilot rail), and leave everything as an `ai-assisted` DRAFT the author then
 * refines in the existing rich designers. Only the Zod schemas + descriptions
 * travel to the model; the handlers never touch Angular DI.
 */
import { z } from 'zod';
import { agenticTool, type ToolDef } from '@infra-tools/agentic-ui';
import { authoringBridge, lastDraft } from './authoring-bridge';

/** The governed capability kinds an author can create. */
const KIND = z.enum([
  'form', 'page', 'workflow', 'decision', 'application', 'theme',
  'experience', 'tool', 'datasource', 'prompt', 'skill', 'navigation', 'validation',
]);

const createDraftCapability = agenticTool({
  name: 'createDraftCapability',
  description:
    'Create a governed capability as an AI-assisted DRAFT the author can then refine and publish. '
    + 'Choose the right `kind` and emit a `body` matching that kind. For kind="form" the body MUST be '
    + '{ "description": string, "schema": { "fields": [ { "name": string, "type": '
    + '"text"|"email"|"number"|"date"|"textarea"|"select"|"checkbox"|"radio"|"section", "label"?: string, '
    + '"required"?: boolean, "options"?: string[] } ] } }. '
    + 'Use short kebab-case names. After creating, tell the author it is a draft and offer to open it in the designer.',
  schema: z.object({
    kind: KIND.describe('The capability kind to create.'),
    name: z.string().min(1).describe('A short kebab-case name, e.g. "contact-form".'),
    body: z.record(z.unknown()).describe('The capability body for this kind (see the form contract above).'),
  }),
  handler: async ({ kind, name, body }) => {
    if (!authoringBridge.createDraft) {
      return { ok: false, error: 'The authoring copilot is not active.' };
    }
    try {
      const draft = await authoringBridge.createDraft(kind, name, body as Record<string, unknown>);
      lastDraft.set(draft);
      return { ok: true, id: draft.id, kind: draft.kind, name: draft.name, designerPath: draft.designerPath };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
});

const listCapabilities = agenticTool({
  name: 'listCapabilities',
  description: 'List governed capabilities the author has, optionally filtered to one kind, so you can reuse or avoid duplicating them.',
  schema: z.object({ kind: KIND.optional().describe('Optional kind filter.') }),
  handler: async ({ kind }) => {
    if (!authoringBridge.list) return { count: 0, items: [] as unknown[] };
    const items = await authoringBridge.list(kind);
    return { count: items.length, items };
  },
});

const getCapability = agenticTool({
  name: 'getCapability',
  description: 'Fetch one capability (by id, or by name plus kind) to inspect its current body before editing or referencing it.',
  schema: z.object({
    idOrName: z.string().describe('The capability id, or its name (pass kind too when using a name).'),
    kind: KIND.optional().describe('The kind, required when idOrName is a name.'),
  }),
  handler: async ({ idOrName, kind }) => {
    if (!authoringBridge.get) return { found: false };
    const body = await authoringBridge.get(idOrName, kind);
    return body ? { found: true, body } : { found: false };
  },
});

const updateDraftCapability = agenticTool({
  name: 'updateDraftCapability',
  description:
    'Refine an EXISTING draft — shallow-merge `bodyPatch` into its body (top-level keys are replaced). '
    + 'ALWAYS call getCapability first to read the current body, then send the WHOLE updated value for any '
    + 'key you change. For a form, to add/remove/edit fields send the entire `schema` with ALL fields '
    + '(the array is replaced, not merged): { "schema": { "fields": [ …all existing fields plus your change… ] } }. '
    + 'Leaves it a draft. Returns where to open it.',
  schema: z.object({
    idOrName: z.string().describe('The capability id, or its name (pass kind too when using a name).'),
    kind: KIND.optional().describe('The kind, required when idOrName is a name.'),
    bodyPatch: z.record(z.unknown()).describe('Top-level body keys to replace (send full sub-objects/arrays).'),
  }),
  handler: async ({ idOrName, kind, bodyPatch }) => {
    if (!authoringBridge.updateDraft) return { ok: false, error: 'The authoring copilot is not active.' };
    try {
      const draft = await authoringBridge.updateDraft(idOrName, kind, bodyPatch as Record<string, unknown>);
      lastDraft.set(draft);
      return { ok: true, id: draft.id, kind: draft.kind, name: draft.name, designerPath: draft.designerPath };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
});

/** The copilot tool-kit passed to `provideAgenticUiPlatform`. */
export const authoringTools: ToolDef[] = [createDraftCapability, updateDraftCapability, listCapabilities, getCapability] as unknown as ToolDef[];
