# Swap the backend

The library ships three backend adapters — AG-UI, Hashbrown, A2UI — each behind a single `provideXxxBackend(...)` provider. Switching is a one-line change.

## AG-UI (default)

Talks to any AG-UI-compatible server (CopilotKit / Mastra / LangGraph / OpenAI Agent SDK / Pydantic AI / etc.) via SSE.

```ts
import { provideAgUiBackend } from '@maverick/agentic-ui/ag-ui';

provideAgUiBackend({
  url: 'http://localhost:4111/agents/gemini/run',
  headers: { Authorization: `Bearer ${TOKEN}` },
}),
```

Capabilities advertised: `streaming`, `clientTools`, `generativeUi`. Generative UI is detected from the `showComponents` tool result convention.

## Hashbrown

Hashbrown is LiveLoveApp's model-agnostic UI generation lib (OpenAI + Google variants).

```ts
import { provideHashbrownBackend } from '@maverick/agentic-ui/hashbrown';

provideHashbrownBackend({
  url: 'http://localhost:4111/hashbrown',
  model: 'openai',  // or 'google'
}),
```

The adapter assumes the server emits NDJSON event lines compatible with the `AgenticEvent` union. Servers using a different shape can either translate at the edge or override `mapServerEvent` in a subclass.

## A2UI

A2UI's distinguishing feature: agents can issue UI ops (route changes, store mutations, form fills) via `ui-action` events. The default `UiActionDispatcher` resolves these against `ActionRegistry` — register actions with `agenticAction({...})` to handle them.

```ts
import { provideA2uiBackend } from '@maverick/agentic-ui/a2ui';

provideA2uiBackend({
  url: 'http://localhost:4111/a2ui',
  specVersion: '0.x',
}),
```

Want a custom dispatcher (e.g., to log every action, or route specific ops outside `ActionRegistry`)?

```ts
import { UI_ACTION_DISPATCHER } from '@maverick/agentic-ui/a2ui';
import { Store } from '@ngrx/store';

providers: [
  provideA2uiBackend({ url: '...' }),
  {
    provide: UI_ACTION_DISPATCHER,
    useFactory: () => {
      const store = inject(Store);
      return { dispatch: (action) => store.dispatch({ type: action.op, ...(action.payload as object) }) };
    },
  },
],
```

## Multiple backends + runtime switch

`provideAgenticBackend(...)` is what each `provide*Backend` returns under the hood — you can register multiple and switch with `BackendRegistry.setActive(id)`:

```ts
import { BackendRegistry } from '@maverick/agentic-ui';

const backends = inject(BackendRegistry);
backends.list().map((b) => b.label);   // ['AG-UI', 'Hashbrown']
backends.setActive('hashbrown');        // chat shell now uses Hashbrown
```

Useful for evaluation UI ("compare AG-UI vs Hashbrown response on the same prompt") and AB tests.

## Custom backend

```bash
ng g @maverick/agentic-ui:backend AcmeBackend
```

Generates a class implementing `AgenticBackend` plus a `provideAcmeBackend(config)` factory. Drop your protocol's wire-format mapping in the `run()` async generator.
