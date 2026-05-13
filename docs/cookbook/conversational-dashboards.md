# Conversational dashboard composition

> **Status:** ships in v1.2.x (P3.B of [post-chat-surfaces plan](../plans/post-chat-surfaces-plan.md)) · **ADR:** [0044](../adr/0044-dashboard-registry.md) · **Pattern:** §3 Pillar 3 — Flavour B

User asks the chat: *"Build me a dashboard tracking custodian SLAs and privilege rates by reviewer."* The agent proposes a `DashboardDef` with 3–6 tiles drawn from already-registered tools + widgets. The user reviews the draft in an inline preview pane, swaps a couple of widgets, removes a tile they don't want, and clicks **Commit**. The new dashboard lands in `DashboardRegistry` with a fresh version + a `parentVersion` link to any prior version.

This is what P3.B's `<mvk-dashboard-preview>` makes possible. The component is dispatch-agnostic — the LLM-side `proposeDashboard` tool is a host implementation concern; the lib provides the canvas, the preview-edit chrome, and a small versioning helper.

## 1. The host-side `proposeDashboard` tool (one example shape)

Adopters register this once. The handler takes free-form intent, calls the LLM (or any policy you prefer), and returns a `DashboardDef`. The runtime renders it through the chat shell's generative-UI path *(or through a dedicated preview surface — see §3)*.

```ts
import { agenticTool, DashboardRegistry, ToolRegistry, ComponentRegistry, LayoutRegistry } from '@infra-tools/agentic-ui';
import { z } from 'zod';

agenticTool({
  name: 'proposeDashboard',
  description: 'Propose a draft dashboard from natural-language intent. ' +
               'Returns a DashboardDef the user reviews + commits.',
  schema: z.object({ intent: z.string() }),
  handler: async (args, ctx) => {
    // Persona-filtered surfaces the LLM is allowed to pick from.
    const tools = inject(ToolRegistry).list();
    const widgets = inject(ComponentRegistry).list();
    const layouts = inject(LayoutRegistry).list();

    // Hand the lists + the user's intent to your LLM. Two patterns:
    // (a) Structured-output: schema = DashboardDef; let the model emit
    //     a parsed object directly.
    // (b) Tool-chain: model picks tile widgets + tools step-by-step;
    //     your handler assembles the DashboardDef.
    const draft: DashboardDef = await draftFromLlm({ intent: args.intent, tools, widgets, layouts });

    // Tag it so the audit trail captures who proposed what.
    return {
      ...draft,
      source: 'user',
      version: 'v1',     // bumped on commit via bumpDashboardVersion()
      tags: [...(draft.tags ?? []), 'agent-proposed'],
    };
  },
});
```

The LLM call shape is yours. The lib doesn't ship one because the right pattern depends on which provider you use (Anthropic structured output, Gemini function calling, AG-UI tool chain, ...) and the lib stays UI-tier per [ADR-010](../adr/0010-platform-principles-and-license.md).

## 2. Routing the tool result into a preview surface

Tools normally surface their results inside the chat transcript. For dashboards, you typically want the draft to render *outside* the chat — in a side panel or a modal — so the user has room to edit. Two ways:

**Pattern A — emit a `layout-render` event from the agent server.** Use ADR-043's slot-based workspace layout to drop the preview into the main pane while the chat collapses to a pill. Cleanest UX:

```ts
// In your ServerAgent, after proposeDashboard returns the DashboardDef:
yield {
  type: 'layout-render',
  layoutName: 'dashboard-preview',
  slots: {
    primary: { component: 'dashboardPreview', props: { draft } },
  },
};
```

Register `dashboardPreview` as a widget that wraps `<mvk-dashboard-preview>`:

```ts
agenticWidget({
  name: 'dashboardPreview',
  component: HostDashboardPreviewWidget,
  propsSchema: z.object({ draft: dashboardDefSchema }),
});
```

**Pattern B — write the draft to a host signal directly from the chat-shell's tool-result side-channel.** Simpler for one-off scenarios:

```ts
@Component({
  template: `
    @if (draft(); as d) {
      <mvk-dashboard-preview
        [draft]="d"
        (commit)="onCommit($event)"
        (discard)="draft.set(null)" />
    }
  `,
})
class DashboardLab {
  readonly draft = signal<DashboardDef | null>(null);

  // Listen for the proposeDashboard tool result via your usual side-channel
  // (chat ref → tool-result observer, or AG-UI state, etc.).
  onProposeResult(d: DashboardDef): void {
    this.draft.set(d);
  }
}
```

## 3. The preview pane — edit-in-place affordances

`<mvk-dashboard-preview>` is a thin editor around `<mvk-dashboard-canvas>`. Hover any tile (or the tile list in the side panel) and you get:

| Control | What it does |
|---|---|
| **Title input** | Click-to-edit. Updates emit `(draftChange)` per keystroke. |
| **Description input** | Same — empty value clears the field on commit. |
| **Component select** per tile | Dropdown of every widget in `ComponentRegistry` (persona-filtered automatically). Swap the renderer without changing the tile's `invocation`. |
| **× per tile** | Remove from the draft. The canvas reflects immediately. |
| **Commit** | Emits `(commit)` with the edited `DashboardDef`. Host versions + persists. |
| **Discard** | Emits `(discard)`. Host clears the draft. |

The preview never mutates the `[draft]` input directly — every edit flows through an internal signal and emits `(draftChange)` so hosts can autosave or stream the diff.

## 4. Commit-as-new-version

When the user clicks Commit, the host typically bumps the version and writes the new def into `DashboardRegistry`:

```ts
import { bumpDashboardVersion, DashboardRegistry } from '@infra-tools/agentic-ui';

onCommit(draft: DashboardDef): void {
  // Look up the prior version (if any) under the same name.
  const prior = this.dashboards.get(draft.name) ?? null;

  // bumpDashboardVersion: v1 → v2 (and sets parentVersion = 'v1').
  // For a fresh dashboard, version starts at 'v1' with no parentVersion.
  const next = prior ? bumpDashboardVersion(prior, draft) : { ...draft, version: 'v1' };

  this.dashboards.register(next);    // RegistryBase auto-replaces by name
  this.draft.set(null);

  // Optionally write through to a persistent store for cross-session restore.
  this.persistence.write(`dashboards/${next.name}`, next);
}
```

The registry's `register()` writes the entry; existing entries with the same `name` are replaced ([ADR-002](../adr/0002-layered-registry-system.md)). The version chain (`version` + `parentVersion`) lets you walk the edit history; the catalog server can store every accepted version when you want server-side persistence.

## 5. The `bumpDashboardVersion` helper

Intentionally simple — `v1` → `v2` → `v3`. For semver-style discipline override per-call:

```ts
// Default behaviour
bumpDashboardVersion({ version: 'v2' }, draft);
// → { ...draft, version: 'v3', parentVersion: 'v2' }

// Custom override
const next: DashboardDef = {
  ...draft,
  version: '2.1.0',
  parentVersion: prior.version,
};
```

The helper handles edge cases:

- No prior version → returns `version: 'v1'`, no `parentVersion`.
- Non-numeric prior version (e.g. `'r3-alpha'`) → returns `'r3-alpha+1'` with `parentVersion: 'r3-alpha'`. Loud-but-still-correct fallback.

## 6. Persona scope flows through the preview the same way it does the canvas

A junior reviewer who can't see `runTARClassifier` gets that tool's tile rendered as *"Unavailable for your role"* in the preview, exactly as it would render in the live canvas after commit. The component dropdown only lists widgets the persona has access to (`ComponentRegistry.list()` honours `setScopePolicy`).

This is the **point** of the registry-as-substrate design: the LLM can propose any tile the catalog knows about, the preview filters it correctly per-persona automatically, the user sees a coherent view of what they can actually save.

## 7. The architectural property

Three flavours of dashboard composition, one registry layer:

- **Pick-and-place** (P3.A) — drag widgets onto a grid; save.
- **Conversational** (P3.B, this slice) — the LLM proposes; the user edits + commits.
- **Live + drillable** (P3.C, forthcoming) — tiles drill into longer-form views, with `cacheTtlMs` + annotations + replay.

All three produce the same `DashboardDef` shape, all three commit through `DashboardRegistry.register()`, all three honour persona scope and versioning uniformly. The agent doesn't need a separate dashboard-builder; it composes via the same registries the user composes with.

That's the [post-chat-surfaces premise](../plans/post-chat-surfaces-plan.md#2-architectural-premise) made real at the dashboard tier: *the agent is the registries; the surfaces — chat, palette, smart-cell, lifecycle, dashboard preview — are just lenses.*

## 8. Reference

- **Components:**
  - `<mvk-dashboard-preview [draft] (commit) (discard) (draftChange) />` — editable wrapper around `<mvk-dashboard-canvas>`
  - `<mvk-dashboard-canvas>` — full read-only view (used internally; also available standalone for the live route, see [dashboards.md](./dashboards.md))
- **Helper:** `bumpDashboardVersion(prev, draft)` → `DashboardDef`
- **Tests:** 17 preview specs covering empty state, hydration from input, inline edits (title / description / swap / remove), commit + discard + (draftChange) emission, defensive-clone on commit, version-bump helper edge cases
- **Plan:** [post-chat-surfaces-plan §3 Pillar 3](../plans/post-chat-surfaces-plan.md#pillar-3--user-defined-dashboards-dashboardregistry)
- **Related:**
  - [User-built dashboards (P3.A)](./dashboards.md) — the read-only canvas + registry mechanics
  - [Agent-directed workspace layouts (ADR-043)](./agent-directed-workspace-layouts.md) — slot machinery for routing the preview into the main pane
  - [Proactive triggers + Inbox](./proactive-triggers-and-inbox.md) — `DashboardDef.schedule` binding for cron refresh
