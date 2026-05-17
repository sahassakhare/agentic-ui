import { EnvironmentInjector, runInInjectionContext } from '@angular/core';
import {
  agenticTool,
  type DashboardDef,
  type SlotMap,
  type TileDef,
} from '@infra-tools/agentic-ui';
import { z } from 'zod';
import { ProposedDashboardStore } from '../services/proposed-dashboard.store';
import { WorkspaceLayoutStore } from '../services/workspace-layout.store';

// ── setWorkspaceLayout ─────────────────────────────────────────────────────

const slotPropsSchema = z.unknown().optional();

/**
 * Forgiving `size` schema — LLMs reliably get "60/40 split" wrong by
 * emitting `size: 60` or `size: '60%'` instead of the canonical
 * `{ default: '60%' }` object. We accept all three shapes and
 * normalise inside the handler. The canonical lib type is still the
 * object form; this is purely a tool-surface convenience.
 */
const slotSizeInputSchema = z.union([
  // Canonical object form.
  z.object({
    default: z.string().describe("CSS size — '60%', '320px', etc."),
    min: z.string().optional(),
    max: z.string().optional(),
  }),
  // String shorthand — interpreted as `{ default: '<string>' }`.
  z.string(),
  // Number shorthand — interpreted as `{ default: '<n>%' }`.
  z.number(),
]).describe(
  "Slot size. Three accepted shapes — all normalised to { default: '<css>' }: " +
  "(a) object: { default: '60%', min?: '320px', max?: '70%' }, " +
  "(b) string shorthand: '60%' or '320px', " +
  "(c) number shorthand: 60 — interpreted as percent.",
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

const slotSchema = z.object({
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
    "privilegeLog | kpiTile. Do NOT invent new names — the registry only " +
    "knows these. Use annotationPanel when the user says 'annotations', " +
    "'comments', 'notes', or 'highlights'.",
  ),
  props: slotPropsSchema,
  size: slotSizeInputSchema.optional(),
  pinned: z.boolean().optional(),
  open: z.enum(['inline', 'modal', 'drawer', 'overlay']).optional(),
});

const setWorkspaceLayoutSchema = z.object({
  slots: z.record(z.string(), slotSchema).describe(
    'Slot-name → SlotDef map. Each slot mounts the named ComponentRegistry ' +
    "component via *ngComponentOutlet. Use 'primary', 'sidebar', 'footer' " +
    "as default slot names; the layout component fills them left-to-right. " +
    "EXAMPLE for 60/40 split: " +
    `{ primary: { component: 'documentPreview', size: '60%' }, ` +
    `sidebar: { component: 'tagPanel', size: '40%' } }.`,
  ),
});

export function setWorkspaceLayoutTool(env: EnvironmentInjector) {
  return agenticTool({
    name: 'setWorkspaceLayout',
    description:
      'Reshape the /workspace route into a slot-based layout. Use this when ' +
      'the user asks to "open document preview + tag panel + privilege log in a workspace", ' +
      'or "show me a 60/40 split with the document on the left and annotations on the right". ' +
      'The slot map is signal-backed: /workspace re-renders live the moment this returns. ' +
      'Persona-scoped + persisted to localStorage so refreshing the page keeps the layout.\n\n' +
      'SLOT SIZE: pass either a string ("60%"), a number (60 — treated as %), or an object ' +
      '({ default: "60%", min: "320px" }). All three are accepted; do not return a bare number ' +
      'unless you mean percent. ' +
      'EXAMPLE for "60/40 split with doc on left + annotations on right": ' +
      `{ slots: { primary: { component: "documentPreview", size: "60%" }, ` +
      `sidebar: { component: "tagPanel", size: "40%" } } }.`,
    schema: setWorkspaceLayoutSchema,
    handler: async ({ slots }) => {
      return runInInjectionContext(env, () => {
        // Normalise size on every slot before writing — handler accepts
        // the shorthand forms from the schema and emits canonical
        // { default, min?, max? } objects for the lib.
        const normalised: SlotMap = Object.fromEntries(
          Object.entries(slots).map(([name, def]) => {
            const size = normaliseSize((def as { size?: unknown }).size);
            const cleaned = { ...def } as Record<string, unknown>;
            if (size) cleaned['size'] = size;
            else delete cleaned['size'];
            return [name, cleaned];
          }),
        ) as unknown as SlotMap;
        const store = env.get(WorkspaceLayoutStore);
        store.set(normalised);
        // No auto-nav. The app-root component (`app.ts`) detects
        // `WorkspaceLayoutStore.slots()` non-empty and replaces the
        // routed content with `<mvk-workspace-layout>` in place — so
        // the agent's reshape is visible on whichever route the user
        // happens to be on. Reset banner clears the agent layer +
        // returns to the routed page.
        return {
          ok: true,
          slotsApplied: Object.keys(normalised),
          route: '/workspace',
          message: `Applied workspace layout with ${Object.keys(normalised).length} slot(s) — visible across the app. Click "Reset" on the banner to return to the routed page.`,
        };
      });
    },
  });
}

// ── proposeDashboard ───────────────────────────────────────────────────────

const proposeDashboardSchema = z.object({
  intent: z.string().describe(
    "Short user intent — 'production throughput by week', 'audit chain health', " +
    "'open holds + custodian breakdown'. Used as the dashboard title.",
  ),
  hint: z
    .enum(['holds', 'productions', 'audit', 'matter-health'])
    .optional()
    .describe(
      "Topic hint that picks which tools the proposed tiles invoke. " +
      "Falls back to 'matter-health' (a mix of holds + custodians).",
    ),
});

export function proposeDashboardTool(env: EnvironmentInjector) {
  return agenticTool({
    name: 'proposeDashboard',
    description:
      'Propose a new dashboard the user can preview before committing. Build a ' +
      'DashboardDef with 2-3 tiles based on the intent text and an optional ' +
      'topic hint, then push it into the proposed-dashboard store so the ' +
      '/dashboards page surfaces a banner with Preview / Commit / Dismiss. ' +
      "Use this when the user asks 'build me a dashboard for production status' " +
      "or 'I want to see a custom dashboard with X and Y'.",
    schema: proposeDashboardSchema,
    handler: async ({ intent, hint }) => {
      return runInInjectionContext(env, () => {
        const store = env.get(ProposedDashboardStore);
        const def = buildDashboardForHint(intent, hint ?? 'matter-health');
        store.propose(def);
        return {
          ok: true,
          name: def.name,
          title: def.title,
          tileCount: def.tiles.length,
          route: '/dashboards',
          message:
            `Proposed dashboard "${def.title}" with ${def.tiles.length} tile(s). ` +
            `Open /dashboards — a banner at the top lets you Preview / Commit / Dismiss.`,
        };
      });
    },
  });
}

const HINT_PRESETS: Record<string, readonly TileDef[]> = {
  holds: [
    {
      id: 'pending-holds',
      slot: 'primary',
      title: 'Pending hold acknowledgements',
      component: 'kpiTile',
      invocation: { kind: 'tool', tool: 'listLegalHolds', args: { status: 'pending' } },
      refreshOn: 'load',
      drilldown: { route: '/holds' },
    },
    {
      id: 'all-holds',
      slot: 'primary',
      title: 'Total holds',
      component: 'kpiTile',
      invocation: { kind: 'tool', tool: 'listLegalHolds', args: {} },
      refreshOn: 'load',
      drilldown: { route: '/holds' },
    },
  ],
  productions: [
    {
      id: 'productions-page',
      slot: 'primary',
      title: 'Open the Productions page',
      component: 'kpiTile',
      invocation: { kind: 'tool', tool: 'openProductions', args: {} },
      refreshOn: 'load',
      drilldown: { route: '/productions' },
    },
    {
      id: 'production-blurb',
      slot: 'primary',
      title: 'About this dashboard',
      component: 'kpiTile',
      invocation: {
        kind: 'static',
        props: {
          markdown: 'Production-focused dashboard — agent-proposed from intent.',
        },
      },
    },
  ],
  audit: [
    {
      id: 'holds-snapshot',
      slot: 'primary',
      title: 'Holds in chain',
      component: 'kpiTile',
      invocation: { kind: 'tool', tool: 'listLegalHolds', args: {} },
      refreshOn: 'load',
      drilldown: { route: '/audit' },
    },
    {
      id: 'audit-blurb',
      slot: 'primary',
      title: 'Audit context',
      component: 'kpiTile',
      invocation: {
        kind: 'static',
        props: {
          markdown:
            'Every state-mutating tool call lands in the chain (prevHash → ' +
            'chainHash). Open the Audit route to scrub the hash-block strip.',
        },
      },
    },
  ],
  'matter-health': [
    {
      id: 'pending-holds',
      slot: 'primary',
      title: 'Pending holds',
      component: 'kpiTile',
      invocation: { kind: 'tool', tool: 'listLegalHolds', args: { status: 'pending' } },
      refreshOn: 'load',
      drilldown: { route: '/holds' },
    },
    {
      id: 'custodians-on-hold',
      slot: 'primary',
      title: 'Custodians on hold',
      component: 'kpiTile',
      invocation: { kind: 'tool', tool: 'listCustodians', args: { onHold: true } },
      refreshOn: 'load',
      drilldown: { route: '/custodians' },
    },
  ],
};

function buildDashboardForHint(intent: string, hint: keyof typeof HINT_PRESETS): DashboardDef {
  const slug = intent
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || `proposed-${Date.now()}`;
  return {
    name: `agentProposed.${slug}`,
    title: intent || 'Agent-proposed dashboard',
    description: `Proposed by the agent from intent: "${intent}". Hint: ${hint}.`,
    layout: 'rail',
    version: 'v1',
    tiles: HINT_PRESETS[hint],
  };
}
