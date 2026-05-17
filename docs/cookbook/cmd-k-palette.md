# ⌘K / Ctrl+K palette — summon the agent from any route

> **Status:** ships in v1.2.x (P1.1 of [post-chat-surfaces plan](../plans/post-chat-surfaces-plan.md)) · **Pattern:** §3 Pillar 1 row 9

The chat rail is for typing. The command palette is for *navigating the agent's capabilities by keyboard*. `<mvk-cmd-k-palette>` opens on `⌘K` (Mac) or `Ctrl+K` (Linux/Win) anywhere in the document and resolves what the user types in three layers — **intents → tools → free-text fallback** — before handing the resolved choice back to the host for dispatch.

The palette stays **decoupled from chat / routing / actions**. It emits a `(selected)` event with a typed `CmdKResult`; the host wires the actual side-effect. That's how the same palette serves chat-style apps, page-routing apps, and direct-tool-invoke apps without forking.

## 1. Drop it into the shell

```ts
// app.component.ts
import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { CmdKPaletteComponent, injectAgenticChat } from '@infra-tools/agentic-ui';
import type { CmdKResult } from '@infra-tools/agentic-ui';

@Component({
  selector: 'app-root',
  imports: [CmdKPaletteComponent /* + your routed shell */],
  template: `
    <!-- your three-pane shell with chat rail / outlet -->
    <mvk-cmd-k-palette (selected)="onPick($event)" />
  `,
})
export class AppComponent {
  private readonly router = inject(Router);
  private readonly chat = injectAgenticChat();

  onPick(result: CmdKResult): void {
    switch (result.kind) {
      case 'route':
        this.router.navigateByUrl(result.target);
        return;
      case 'action':
        // Wire to your ActionRegistry or domain dispatcher.
        // ActionRegistry.dispatch({ name: result.target, payload: {} });
        return;
      case 'tool':
      case 'chat':
        // Send as a chat prompt so the agent picks args + executes
        // through the orchestrator's normal flow.
        this.chat.sendMessage(result.target);
        return;
    }
  }
}
```

That's it. No other config — the palette listens for `⌘K` / `Ctrl+K` globally, reads `IntentRegistry` + `ToolRegistry` directly (persona-scoped via `setScopePolicy`), and dispatches via your handler.

It also opens on `/` (Slack/GitHub-style) when no input has focus.

## 2. How the matcher works

User types `"open custodians"`. The palette resolves in three layers:

1. **Intents first.** `IntentRegistry.list()` is searched — the registry's substring matcher checks each intent's `examples`, `description`, and `name` against the query. If anything matches, those rows render at the top, each tagged with their typed `mapsTo.kind` (`tool` / `action` / `route`).
2. **Tools fallback.** When **no intent matched**, `ToolRegistry.list()` is searched — `name` and `description` substring match. Tool rows dispatch as chat prompts (the palette doesn't try to fill out tool arguments from a single input; that's the LLM's job).
3. **Free-text fallback.** Always present at the bottom for non-empty queries — *"Ask: <query>"*. Selecting it sends the raw query through the agent.

Each row carries `kind`, `source`, `target`, `label`, `description`. The host's handler switches on `kind` to dispatch.

## 3. Register an intent for first-class matching

For phrases you want to short-circuit pre-LLM (latency-sensitive flows, offline mode, exact-match routing), register an `IntentDef`:

```ts
import { provideAgenticUi } from '@infra-tools/agentic-ui';
import { agenticIntent } from '@infra-tools/agentic-ui';
import { z } from 'zod';

provideAgenticUi({
  intents: [
    agenticIntent({
      id: 'open-custodians',
      description: 'Open the custodians list',
      examples: ['open custodians', 'show custodians', 'list custodians'],
      schema: z.object({}),
      mapsTo: { kind: 'route', target: '/custodians' },
    }),
    agenticIntent({
      id: 'place-legal-hold',
      description: 'Place a new legal hold',
      examples: ['place legal hold', 'issue hold', 'lock matter'],
      schema: z.object({}),
      mapsTo: { kind: 'action', target: 'place-legal-hold' },
    }),
    agenticIntent({
      id: 'search-docs',
      description: 'Search documents',
      examples: ['find docs', 'search documents', 'lookup'],
      schema: z.object({ query: z.string() }),
      mapsTo: { kind: 'tool', target: 'searchDocuments' },
    }),
  ],
});
```

Now `"open custodians"` resolves to a `route` row, `"place legal hold"` to an `action` row, `"find docs about Project Phoenix"` to a `tool` row — all without an LLM round-trip.

## 4. Keyboard semantics

| Key | Action |
|---|---|
| `⌘K` / `Ctrl+K` | Open palette (from anywhere) |
| `/` | Open palette when no input is focused |
| `Esc` | Close |
| `↑` / `↓` | Navigate results |
| `Enter` | Select highlighted result |
| **Click backdrop** | Close |

## 5. The architectural property

`<mvk-cmd-k-palette>` is a **second surface** that reads from the same registries the chat shell reads from. Six personas with `setScopePolicy` see six different palettes — junior reviewer's palette is shorter, partner's is fuller, GC's might include cross-matter intents the others don't. Same audit chain when the host dispatches a tool — `origin: 'cmd-k'` makes the entry point queryable in `Audit`.

The palette never executes anything itself. It resolves, emits, closes. That's the [post-chat-surfaces premise](../plans/post-chat-surfaces-plan.md#2-architectural-premise) made real: *the agent is the registries; the surfaces are just lenses.*

## 6. Reference

- **Component:** `<mvk-cmd-k-palette (selected)="...">`
- **Result type:** `CmdKResult` (`kind`: `tool` | `action` | `route` | `chat`)
- **Tests:** 14 specs covering ⌘K + Ctrl+K + `/` opens, Esc / backdrop close, intent priority, tool fallback, free-text fallback, arrow navigation, selection close + emit
- **Plan:** [post-chat-surfaces-plan §3 Pillar 1 pattern 9](../plans/post-chat-surfaces-plan.md#pillar-1--web-surface-patterns-post-chat-affordances) + cookbook §11
- **Related:** [Agent-directed workspace layouts (ADR-043)](./agent-directed-workspace-layouts.md), [IntentRegistry](../architecture/platform-seams.md)
