import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import {
  agenticTool,
  DashboardRegistry,
  DashboardTemplateRegistry,
  LayoutResolver,
  LayoutTemplateRegistry,
  slotEdits,
  type DashboardDef,
  type SlotDef,
  type SlotMap,
} from '@infra-tools/agentic-ui';
import { z } from 'zod';
import { WorkspaceLayoutStore } from '../services/workspace-layout.store';

// No router navigation here — the app-root component (app.ts)
// detects WorkspaceLayoutStore.slots() non-empty and renders the
// resolved <mvk-workspace-layout> IN PLACE of the routed content
// on whichever route the user is on. The agent's reshape is visible
// across the app without a forced navigation.

// ── ADR-047 D1 — slot-level edit tools ────────────────────────────────────

/**
 * Forgiving `size` schema — same pattern as dynamic-surface.tools.ts.
 * Accepts the canonical object form, a string shorthand, or a number
 * (interpreted as percent). Normalised inside the handler.
 */
const slotSizeInputSchema = z.union([
  z.object({
    default: z.string().describe("CSS size — '60%', '320px', etc."),
    min: z.string().optional(),
    max: z.string().optional(),
  }),
  z.string(),
  z.number(),
]).describe(
  "Slot size. Accepted shapes — all normalised to { default: '<css>' }: " +
  "object { default: '60%', min?, max? } | string '60%' | number 60 (percent).",
);

function normaliseSize(s: unknown): { default: string; min?: string; max?: string } | undefined {
  if (s === null || s === undefined) return undefined;
  if (typeof s === 'string') return { default: s };
  if (typeof s === 'number') return { default: `${s}%` };
  if (typeof s === 'object') {
    const obj = s as { default?: string; min?: string; max?: string };
    if (typeof obj.default === 'string') return obj as { default: string; min?: string; max?: string };
  }
  return undefined;
}

const addSlotSchema = z.object({
  slot: z.string().describe("Slot name — 'primary' | 'sidebar' | 'footer' | …"),
  component: z.enum([
    'documentPreview',
    'tagPanel',
    'annotationPanel',
    'chainOfCustody',
    'bulkActions',
    'multiDocPreview',
    'privilegeLog',
    'kpiTile',
  ]).describe(
    "ComponentRegistry name. MUST be one of: documentPreview | tagPanel | " +
    "annotationPanel | chainOfCustody | bulkActions | multiDocPreview | " +
    "privilegeLog | kpiTile. Do NOT invent new names; the demo only " +
    "registers these. annotationPanel covers annotations / comments / " +
    "notes / highlights.",
  ),
  size: slotSizeInputSchema.optional(),
  props: z.unknown().optional(),
});

export function addLayoutSlotTool(env: EnvironmentInjector) {
  return agenticTool({
    name: 'addLayoutSlot',
    description:
      'Add a single slot to the current workspace layout WITHOUT replacing ' +
      'the other slots. Use this when the user asks to "add a chain-of-' +
      'custody footer" or "put a tag panel in the sidebar" — preserves ' +
      'whatever else is already there. If the slot already exists, this ' +
      'is a no-op; use replaceLayoutSlot to overwrite.',
    schema: addSlotSchema,
    handler: async ({ slot, component, size, props }) => {
      return runInInjectionContext(env, () => {
        const store = env.get(WorkspaceLayoutStore);
        const resolver = env.get(LayoutResolver);
        // Start from the agent's current slot map. If the agent layer
        // is empty, seed from the resolved layout so we preserve
        // route/persona contributions when adding.
        const base: SlotMap = store.slots() ?? resolver.active().slots;
        const normSize = normaliseSize(size);
        const def: SlotDef = { component, ...(normSize ? { size: normSize } : {}), ...(props !== undefined ? { props } : {}) };
        const next = slotEdits.add(base, slot, def);
        store.set(next);
        return {
          ok: true,
          slot,
          component,
          totalSlots: Object.keys(next).length,
          message: `Added "${slot}" → ${component}. Workspace now has ${Object.keys(next).length} slot(s).`,
        };
      });
    },
  });
}

const removeSlotSchema = z.object({
  slot: z.string().describe('Slot name to drop from the current workspace layout.'),
});

export function removeLayoutSlotTool(env: EnvironmentInjector) {
  return agenticTool({
    name: 'removeLayoutSlot',
    description:
      'Drop one slot from the current workspace layout. Use this when ' +
      'the user asks to "hide the footer" or "drop the tag panel". The ' +
      'other slots are preserved. No-op when the named slot does not ' +
      'currently exist.',
    schema: removeSlotSchema,
    handler: async ({ slot }) => {
      return runInInjectionContext(env, () => {
        const store = env.get(WorkspaceLayoutStore);
        const resolver = env.get(LayoutResolver);
        const base: SlotMap = store.slots() ?? resolver.active().slots;
        const next = slotEdits.remove(base, slot);
        store.set(next);
        return {
          ok: true,
          slot,
          totalSlots: Object.keys(next).length,
          message: `Removed "${slot}". Workspace now has ${Object.keys(next).length} slot(s).`,
        };
      });
    },
  });
}

const replaceSlotSchema = addSlotSchema;

export function replaceLayoutSlotTool(env: EnvironmentInjector) {
  return agenticTool({
    name: 'replaceLayoutSlot',
    description:
      'Replace (or insert) one slot in the current workspace layout. ' +
      'Use this when the user says "swap the sidebar for the privilege log" — ' +
      'preserves every other slot. Equivalent to addLayoutSlot when the ' +
      'slot did not exist.',
    schema: replaceSlotSchema,
    handler: async ({ slot, component, size, props }) => {
      return runInInjectionContext(env, () => {
        const store = env.get(WorkspaceLayoutStore);
        const resolver = env.get(LayoutResolver);
        const base: SlotMap = store.slots() ?? resolver.active().slots;
        const normSize = normaliseSize(size);
        const def: SlotDef = { component, ...(normSize ? { size: normSize } : {}), ...(props !== undefined ? { props } : {}) };
        const next = slotEdits.replace(base, slot, def);
        store.set(next);
        return {
          ok: true,
          slot,
          component,
          totalSlots: Object.keys(next).length,
          message: `Replaced "${slot}" with ${component}. Workspace now has ${Object.keys(next).length} slot(s).`,
        };
      });
    },
  });
}

// ── ADR-047 D2 — template-aware tools ─────────────────────────────────────

const listLayoutTemplatesSchema = z.object({
  tags: z.array(z.string()).optional().describe('Filter to templates carrying any of these tags.'),
});

export function listLayoutTemplatesTool(env: EnvironmentInjector) {
  return agenticTool({
    name: 'listLayoutTemplates',
    description:
      'List approved layout templates available in the catalog. Returns ' +
      'name, title, description, tags, version — use to recommend a ' +
      'template by name before calling applyLayoutTemplate. Only approved ' +
      'templates are returned (drafts + rejected + deprecated are hidden).',
    schema: listLayoutTemplatesSchema,
    handler: async ({ tags }) => {
      return runInInjectionContext(env, () => {
        const reg = env.get(LayoutTemplateRegistry);
        let entries = reg.approved();
        if (tags && tags.length > 0) {
          const tagSet = new Set(tags);
          entries = entries.filter((t) => t.tags.some((x) => tagSet.has(x)));
        }
        return {
          ok: true,
          count: entries.length,
          templates: entries.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            tags: t.tags,
            version: t.version ?? 'v1',
            visibility: t.visibility,
          })),
        };
      });
    },
  });
}

const applyLayoutTemplateSchema = z.object({
  name: z.string().describe('Template name (from listLayoutTemplates).'),
});

export function applyLayoutTemplateTool(env: EnvironmentInjector) {
  return agenticTool({
    name: 'applyLayoutTemplate',
    description:
      'Apply a named layout template to the workspace. The template body ' +
      'is read from LayoutTemplateRegistry; if the template carries a ' +
      'slotMap, it is written into WorkspaceLayoutStore (agent layer). ' +
      'Use after listLayoutTemplates to confirm the name. Throws when the ' +
      'template is not approved or not registered.',
    schema: applyLayoutTemplateSchema,
    handler: async ({ name }) => {
      return runInInjectionContext(env, () => {
        const reg = env.get(LayoutTemplateRegistry);
        const template = reg.get(name);
        if (!template) {
          return { ok: false, error: `Template "${name}" not found in catalog.` };
        }
        if (template.approvalState !== 'approved') {
          return {
            ok: false,
            error: `Template "${name}" is in state "${template.approvalState}" — only approved templates can be applied.`,
          };
        }
        // For the demo, templates carry their slot map directly on
        // the body's `slotMap` field. Adopters with parameterized
        // templates extend this with a `produce(params)` call.
        const slotMap = (template.body.slotMap as SlotMap | undefined) ?? null;
        if (slotMap) {
          env.get(WorkspaceLayoutStore).set(slotMap);
        }
        return {
          ok: true,
          name,
          title: template.title,
          appliedSlots: slotMap ? Object.keys(slotMap) : [],
          message:
            `Applied template "${template.title}" (${name}). ` +
            (slotMap
              ? `Workspace now has ${Object.keys(slotMap).length} slot(s) — visible wherever you are.`
              : `Template registered; no inline slotMap to apply.`),
        };
      });
    },
  });
}

const listDashboardTemplatesSchema = z.object({
  tags: z.array(z.string()).optional().describe('Filter to templates carrying any of these tags.'),
});

export function listDashboardTemplatesTool(env: EnvironmentInjector) {
  return agenticTool({
    name: 'listDashboardTemplates',
    description:
      'List approved dashboard templates. Returns name, title, description, ' +
      'tags, version — use to recommend by name before applyDashboardTemplate.',
    schema: listDashboardTemplatesSchema,
    handler: async ({ tags }) => {
      return runInInjectionContext(env, () => {
        const reg = env.get(DashboardTemplateRegistry);
        let entries = reg.approved();
        if (tags && tags.length > 0) {
          const tagSet = new Set(tags);
          entries = entries.filter((t) => t.tags.some((x) => tagSet.has(x)));
        }
        return {
          ok: true,
          count: entries.length,
          templates: entries.map((t) => ({
            name: t.name,
            title: t.title,
            description: t.description,
            tags: t.tags,
            version: t.version ?? 'v1',
            tileCount: t.body.tiles.length,
          })),
        };
      });
    },
  });
}

const applyDashboardTemplateSchema = z.object({
  name: z.string().describe('Template name (from listDashboardTemplates).'),
});

export function applyDashboardTemplateTool(env: EnvironmentInjector) {
  return agenticTool({
    name: 'applyDashboardTemplate',
    description:
      'Materialize an approved dashboard template into DashboardRegistry. ' +
      'The user can then pick it on /dashboards. Stamps source: "user" ' +
      'so it joins user-committed dashboards. Throws when the template is ' +
      'not approved or not registered.',
    schema: applyDashboardTemplateSchema,
    handler: async ({ name }) => {
      return runInInjectionContext(env, () => {
        const reg = env.get(DashboardTemplateRegistry);
        const template = reg.get(name);
        if (!template) {
          return { ok: false, error: `Template "${name}" not found in catalog.` };
        }
        if (template.approvalState !== 'approved') {
          return {
            ok: false,
            error: `Template "${name}" is in state "${template.approvalState}" — only approved templates can be applied.`,
          };
        }
        const def: DashboardDef = { ...template.body, source: 'user' };
        env.get(DashboardRegistry).register(def);
        return {
          ok: true,
          name,
          title: template.title,
          tileCount: def.tiles.length,
          message:
            `Registered dashboard "${template.title}" from template ${name}. ` +
            `Open /dashboards to see it in the picker.`,
        };
      });
    },
  });
}
