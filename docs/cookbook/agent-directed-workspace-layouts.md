# Agent-directed workspace layouts

> **Status:** ships in v1.2.x ·  **ADR:** [0043](../adr/0043-layout-registry-promotion.md) · **Plan:** [post-chat-surfaces P0](../plans/post-chat-surfaces-plan.md)

When the agent picks `documentPreview` + `tagPanel` + `privilegeLog` together, they shouldn't stack as three cards in the chat transcript — they should **take over the screen the way a real reviewer would expect**. That's what `<mvk-workspace-layout>` is for. The agent emits a `layout-render` event; the host reads it from `AgenticChatRef.activeLayout` and mounts the workspace layout wherever the route wants it.

This cookbook walks the end-to-end path:

1. Wire the agent's `<mvk-chat-shell>` with a per-route `mode` so the chat collapses to a pill on workspace routes.
2. Have a tool return a `layout-render` event from the server side.
3. Bind `AgenticChatRef.activeLayout` to `<mvk-workspace-layout>` on the route's main pane.

## 1. Per-route shell modes

The cleanest pattern is to provide a `LayoutPolicy` once and let `<mvk-chat-shell>` pick its mode from the active route:

```ts
// app.config.ts
import { ApplicationConfig, inject } from '@angular/core';
import { Router } from '@angular/router';
import { provideAgenticUi, provideLayoutPolicy } from '@infra-tools/agentic-ui';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAgenticUi(),
    provideLayoutPolicy({
      shellMode: (route) => {
        if (route.startsWith('/documents/')) return 'pill';        // doc review
        if (route.startsWith('/holds')) return 'pill';             // lifecycle widget
        if (route.startsWith('/audit')) return 'hidden';           // query bar replaces rail
        if (route === '/' || route.startsWith('/dashboard')) return 'docked-bottom';
        return 'rail';
      },
      density: () => 'comfortable',
    }),
  ],
};
```

In your shell template, bind the chat mode from the policy + router URL:

```ts
@Component({
  template: `<mvk-chat-shell [mode]="shellMode()" />`,
  imports: [ChatShellComponent],
})
class AppShell {
  private readonly router = inject(Router);
  private readonly policy = inject(LAYOUT_POLICY);
  protected readonly shellMode = computed(() =>
    this.policy.shellMode(this.router.url)
  );
}
```

The chat shell stamps `data-mode="..."` on its host element, so apps can style transitions in their own stylesheets (`mvk-chat-shell[data-mode="pill"] { ... }`).

## 2. Emit `layout-render` from a tool

A `layout-render` event has the same wire shape across AG-UI, Hashbrown, and A2UI — your `ServerAgent` yields it like any other event:

```ts
import type { ServerAgent } from '@infra-tools/agentic-ui-server';

export class ReviewAgent implements ServerAgent {
  async *run(input) {
    yield { type: 'RUN_STARTED', threadId: input.threadId, runId: input.runId };

    // Imagine the LLM decided "open document D-117 for review".
    yield {
      type: 'layout-render',
      layoutName: 'review-workbench',
      slots: {
        primary: {
          component: 'documentPreview',
          props: { docId: 'D-117' },
          size: { default: '60%', min: '320px' },
        },
        sidebar: {
          component: 'tagPanel',
          props: { docId: 'D-117' },
          size: { default: '25%' },
        },
        footer: {
          component: 'privilegeLog',
          props: { docId: 'D-117' },
          size: { default: '15%' },
        },
      },
      responsive: [
        { belowPx: 1024, collapse: ['footer'], drawer: ['sidebar'] },
        { belowPx: 768, collapse: ['sidebar', 'footer'], drawer: [] },
      ],
      data: { matterId: 'M-1', docId: 'D-117' },
    };

    yield { type: 'TEXT_MESSAGE_CONTENT', messageId: '1', delta: 'Opening D-117 for review…' };
    yield { type: 'RUN_FINISHED', threadId: input.threadId, runId: input.runId };
  }
}
```

A few rules the orchestrator enforces:

- The slot's `component` must be registered in `ComponentRegistry`. Unknown names render an inline warning card + a `console.warn` — they never crash the layout.
- `props` is Zod-validated against `ComponentDef.propsSchema`. A bad prop falls through to the raw value (matches `<mvk-widget-container>`).
- A malformed `layout-render` event (e.g. empty `component`) is dropped at the orchestrator boundary with a `console.warn` — the prior layout state stays put. Fail-soft.

## 3. Mount the layout on the route

On any route where the workspace is the main content, bind `AgenticChatRef.activeLayout` to `<mvk-workspace-layout>`:

```ts
@Component({
  selector: 'app-doc-review',
  imports: [WorkspaceLayoutComponent],
  template: `
    @if (activeLayout(); as layout) {
      <mvk-workspace-layout
        [layoutName]="layout.layoutName"
        [slots]="layout.slots"
        [responsive]="layout.responsive ?? []" />
    } @else {
      <div class="empty">Ask the agent to open a document.</div>
    }
  `,
})
class DocReviewPage {
  private readonly chat = inject(AGENTIC_CHAT);   // your route-scoped AgenticChatRef
  protected readonly activeLayout = this.chat.activeLayout;

  ngOnDestroy() {
    // Optional: clear the layout when leaving the route so a stale
    // workspace doesn't flash on next entry.
    this.chat.clearLayout();
  }
}
```

The chat rail keeps streaming text + tool calls in the corner pill; the workspace mounts the agent-emitted slots in the main pane. Same `AgenticChatRef` drives both surfaces.

## 4. What this gets you

- **The agent directs the screen.** Multi-pane workspaces are an event the LLM emits, not a hand-coded route component. Add a new layout = new `ComponentRegistry` widget + maybe a new `LayoutDef` for shared shapes.
- **Persona scope applies uniformly.** Slots whose `component` the active persona can't see are filtered out by `ComponentRegistry.list()` reads — same `setScopePolicy` semantics as tools and widgets.
- **Responsive degradation is declarative.** Encode breakpoints in the `responsive` array per-LayoutDef. Mobile + tablet aren't a separate app — they're a collapsed projection of the same layout.
- **MFE remotes can ship layouts.** A `production` MFE remote can register `production-pipeline` as a `LayoutDef` alongside its tools and widgets. `removeBySource` symmetry holds — unload the remote, the layout disappears.
- **Zero breaking changes.** Apps that don't read `activeLayout` see no change. Backends that don't emit `layout-render` events leave the signal at `null`. `<mvk-chat-shell mode="rail">` is the default.

## Reference

- **ADR:** [`0043-layout-registry-promotion.md`](../adr/0043-layout-registry-promotion.md) — six decisions D1–D6, five alternatives considered, P0 implementation sequence.
- **Plan:** [`post-chat-surfaces-plan.md`](../plans/post-chat-surfaces-plan.md) — Pillar 2 (Layout primitives) §3 + P0 exit criteria §9.
- **API:**
  - `<mvk-chat-shell mode="rail | pill | overlay | docked-bottom | assist-panel | hidden">`
  - `<mvk-workspace-layout [layoutName]="..." [slots]="..." [responsive]="..." />`
  - `provideLayoutPolicy({...})` factory
  - `inject(LAYOUT_POLICY)` for per-route shell-mode resolution
  - `AgenticChatRef.activeLayout` signal + `clearLayout()` method
  - `LayoutRenderState` / `SlotDef` / `SlotMap` / `ResponsiveCollapseRule` types
