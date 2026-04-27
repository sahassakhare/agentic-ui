# Quick start

## 1. Install in any standalone Angular 21 app

```bash
ng add @maverick/agentic-ui --backend=ag-ui --skip-install=true
npm install
```

`ng-add` patches `app.config.ts` to add `provideAgenticUi()` + `provideAgUiBackend({ url: '...' })`, scaffolds `src/app/agentic/{tools,widgets}.ts`, and adds the right peer deps.

Without `ng-add`, the equivalent manual setup:

```ts
// app.config.ts
import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideAgenticUi } from '@maverick/agentic-ui';
import { provideAgUiBackend } from '@maverick/agentic-ui/ag-ui';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideAgenticUi({ tools: [], widgets: [] }),
    provideAgUiBackend({ url: 'http://localhost:4111/agents/echo/run' }),
  ],
};
```

## 2. Drop the chat shell into your template

```html
<mvk-chat-shell />
```

```ts
import { ChatShellComponent } from '@maverick/agentic-ui';

@Component({
  selector: 'app-root',
  imports: [ChatShellComponent],
  template: `<mvk-chat-shell />`,
})
export class App {}
```

## 3. Add a tool

```bash
ng g @maverick/agentic-ui:tool bookFlight
```

Generates:

```ts
// src/app/agentic/tools/book-flight.tool.ts
import { agenticTool } from '@maverick/agentic-ui';
import { z } from 'zod';

export const bookFlightTool = agenticTool({
  name: 'bookFlight',
  description: 'Tool description.',
  schema: z.object({
    // TODO: define arguments
  }),
  executeIn: 'host',
  handler: async (args, ctx) => {
    // TODO: implement
    void args; void ctx;
    return { ok: true };
  },
});
```

Register the tool with `provideAgenticUi({ tools: [bookFlightTool] })`.

## 4. Add a widget (generative UI)

```bash
ng g @maverick/agentic-ui:widget FlightCard
```

Generates a standalone component + an `agenticWidget({...})` factory that registers it with the `ComponentRegistry`. The agent can then ask to render it by name.

## 5. Run an agent server

```bash
ng g @maverick/agentic-ui:agent-server my-agent-server
cd projects/my-agent-server
npm install && npm run dev
```

Boots a Hono server on `:4111` exposing the `EchoAgent` (no LLM key required) at `POST /agents/echo/run`. Swap in a real agent (Mastra, LangGraph, Gemini, OpenAI Agent SDK) by implementing the `ServerAgent` interface — see `examples/demo-server/src/gemini-agent.ts` for a working example.

## 6. Try it

Reload the app and type a prompt. Against the echo agent (no LLM), any
prompt works — you'll see your message streamed back word-by-word.
Against an LLM-backed agent with the `bookFlight` tool registered:

> *"Book a flight from LAX to JFK on 2026-05-05"*

The agent calls your tool, your handler returns `{ bookingId, ..., components: [{name: 'flightCard', props}] }`, and the chat shell renders the `flightCard` widget under the tool result.

For prompts covering every demo and every registry, see [Sample prompts](./sample-prompts.md).
