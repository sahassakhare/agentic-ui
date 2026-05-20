# Developer Guide — `@infra-tools/agentic-ui`

> **Audience**: developers building their own agentic UI on top of this library.
> **Before this guide**: read [`CONCEPTS.md`](./CONCEPTS.md) — defines every primitive (Tool, Widget, Capability, Registry, Action, Intent, …) + a decision matrix for "when to use what."
> **Companion docs**: [USER_GUIDE.md](./USER_GUIDE.md) walks the included demos; the [cookbook](./cookbook/) is topic-shaped. This guide is the **sequenced journey** with complete working examples for each step.
> **Time to "Hello, agent"**: ~15 minutes (steps 1–6).

---

## How this guide is organized

19 steps. Steps 1–6 are the minimum. Everything else is opt-in with an explicit "skip if…" clause.

Each step has:
- **Goal**: what state you reach
- **Files to create** (or commands to run)
- **Complete code** (not snippets — every example below is a runnable file)
- **Skip if…**: when this step doesn't apply to your project
- **Cross-reference**: link to the deep cookbook entry

Where to go for the **taxonomy** (what is a Tool? a Capability? a Registry?): [`CONCEPTS.md`](./CONCEPTS.md). This guide assumes you've read it.

---

## Step index

| Step | Goal | Skip if… |
|---|---|---|
| 1 | Install + bootstrap | — (required) |
| 2 | Wire `<mvk-chat-shell>` | — (required) |
| 3 | Wire a backend | — (required) |
| 4 | Define your first tool | …you only need a text chatbot |
| 5 | Define your first widget | …you only need text replies |
| 6 | Run an agent server | …you already have one |
| 7 | Plug in a real LLM | …you're prototyping with Echo |
| 8 | Forms (F1) | …no structured intake |
| 9 | Approvals (F4 — HITL) | …no tool needs sign-off |
| 10 | Long-running operations (F5) | …all tools finish in seconds |
| 11 | Multi-modal input (F6) | …text-only is fine |
| 12 | Federate from MFE remotes | …single team / monolith |
| 13 | Persona scope filtering | …all users see all tools |
| 14 | Telemetry (OpenTelemetry) | …console logs enough |
| 15 | Catalog platform | …no cross-app discovery needed |
| 16 | Expose tools via MCP | …no Claude Desktop / Cursor integration |
| 17 | Teams / M365 Copilot / GitHub Copilot adapters | …those aren't your surfaces |
| 18 | Production deployment | — (required at ship) |
| 19 | Observability + cost guardrails | — (required at scale) |

---

## Step 1 — Install + bootstrap

**Goal**: a fresh Angular 21 app with the library wired into providers.

```bash
ng new my-agentic-app --standalone --skip-tests --style=css --routing=true
cd my-agentic-app
ng add @infra-tools/agentic-ui --backend=ag-ui
```

`ng add` patches `app.config.ts`, scaffolds `src/app/agentic/{tools,widgets}.ts`, and installs the peer deps.

If you skip `ng add` (for example, adopting into an established app), here's the complete equivalent setup:

```ts
// src/app/app.config.ts — complete
import { ApplicationConfig, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import {
  provideAgenticUi,
  provideAgUiBackend,
  provideAgenticTelemetryConsole,
} from '@infra-tools/agentic-ui';
import { routes } from './app.routes';
import { tools } from './agentic/tools';
import { widgets } from './agentic/widgets';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideRouter(routes),

    // 1) Wire the lib's core providers: tools + widgets + (optional)
    //    forms / approvals / operations. We start empty and add in
    //    steps 4, 5, 8, 9, 10.
    provideAgenticUi({
      tools,           // imported from agentic/tools.ts
      widgets,         // imported from agentic/widgets.ts
    }),

    // 2) Wire a backend. Step 3 covers picking AG-UI / Hashbrown / A2UI;
    //    AG-UI is the default and the most-tested.
    provideAgUiBackend({
      url: 'http://localhost:4111/agents/echo/run',
    }),

    // 3) Optional — dev telemetry sink. Logs every span / event to
    //    the browser console. Swap to provideAgenticTelemetry({kind: 'otel'})
    //    in step 14.
    provideAgenticTelemetryConsole(),
  ],
};
```

```ts
// src/app/agentic/tools.ts — starter
import type { ToolDef } from '@infra-tools/agentic-ui';

export const tools: ToolDef[] = [
  // Step 4 adds the first one here.
];
```

```ts
// src/app/agentic/widgets.ts — starter
import type { ComponentDef } from '@infra-tools/agentic-ui';

export const widgets: ComponentDef[] = [
  // Step 5 adds the first one here.
];
```

**Cross-reference**: [`cookbook/quickstart.md`](./cookbook/quickstart.md) · [`cookbook/integrate-into-existing-angular-app.md`](./cookbook/integrate-into-existing-angular-app.md) for adopting into an established Angular app.

---

## Step 2 — Wire `<mvk-chat-shell>`

**Goal**: working chat UI on a route.

```ts
// src/app/app.ts — complete root component
import { Component } from '@angular/core';
import { ChatShellComponent } from '@infra-tools/agentic-ui';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ChatShellComponent],
  template: `
    <div class="shell">
      <header>
        <h1>My agentic app</h1>
      </header>
      <main>
        <mvk-chat-shell />
      </main>
    </div>
  `,
  styles: `
    :host { display: block; height: 100vh; }
    .shell { display: flex; flex-direction: column; height: 100%; }
    header { padding: 0.75rem 1rem; border-bottom: 1px solid #e5e7eb; }
    main { flex: 1; min-height: 0; }
    mvk-chat-shell { display: block; height: 100%; }
  `,
})
export class App {}
```

`ng serve`. The chat UI loads. You can type, but messages haven't anywhere to go yet — step 3 + 6 fix that.

---

## Step 3 — Wire a backend

**Goal**: pick the protocol that connects the chat shell to an agent server.

The default is AG-UI (most-tested; reference server in `examples/demo-server`). Hashbrown and A2UI are also production-grade client adapters per [ADR-048](./adr/0048-backend-adapter-parity-contract.md) but you need to write the server for those — see the [Backend support matrix](../README.md#backend-support-matrix).

```ts
// src/app/app.config.ts — backend variations
import {
  provideAgenticUi,
  provideAgUiBackend,
  provideHashbrownBackend,
  provideA2uiBackend,
} from '@infra-tools/agentic-ui';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZonelessChangeDetection(),
    provideAgenticUi({ tools, widgets }),

    // Pick ONE of these three (or register multiple + swap at runtime):

    // Option A — AG-UI (recommended default)
    provideAgUiBackend({
      url: environment.agentUrl,
      headers: { 'X-App-Version': '1.0.0' },
    }),

    // Option B — Hashbrown
    // provideHashbrownBackend({
    //   url: 'https://hashbrown.example.com/run',
    //   model: 'google',           // or 'openai'
    // }),

    // Option C — A2UI
    // provideA2uiBackend({
    //   url: 'https://a2ui.example.com/run',
    //   specVersion: '0.x',
    // }),
  ],
};
```

To register multiple backends and swap at runtime (e.g. let admins pick the protocol):

```ts
// src/app/components/backend-picker.component.ts
import { Component, inject } from '@angular/core';
import { BackendRegistry } from '@infra-tools/agentic-ui';

@Component({
  selector: 'app-backend-picker',
  standalone: true,
  template: `
    <select (change)="switch($event)">
      <option value="ag-ui">AG-UI</option>
      <option value="hashbrown">Hashbrown</option>
      <option value="a2ui">A2UI</option>
    </select>
  `,
})
export class BackendPickerComponent {
  private readonly backends = inject(BackendRegistry);

  switch(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    this.backends.setActive(id);
  }
}
```

**Cross-reference**: [`cookbook/swap-backend.md`](./cookbook/swap-backend.md) · [ADR-048](./adr/0048-backend-adapter-parity-contract.md).

---

## Step 4 — Define your first tool

**Goal**: give the LLM something to do. See [`CONCEPTS.md → Tool`](./CONCEPTS.md#tool--tooldef-registered-in-toolregistry) for the primitive's definition.

```bash
ng g @infra-tools/agentic-ui:tool bookFlight
```

```ts
// src/app/agentic/tools/book-flight.tool.ts — complete
import { agenticTool } from '@infra-tools/agentic-ui';
import { z } from 'zod';

/**
 * Tool: bookFlight
 *
 * Naming + description matter — the LLM sees BOTH. The description
 * is the model's only signal for "when to use this." Front-load it
 * with the trigger ("Use this when…") and an example.
 */
export const bookFlightTool = agenticTool({
  name: 'bookFlight',
  description:
    'Book a flight between two airports on a given date. ' +
    'Use this when the user says something like "book a flight from LAX to JFK on May 15." ' +
    'Returns a bookingId, the price, and a flight-card widget showing the booking.',

  // Zod schema → JSON-Schema on the wire. The LLM sees the JSON-Schema
  // and reasons about argument shape. `.describe()` text is included in
  // the parameter docs the model reads.
  schema: z.object({
    from: z.string().length(3).describe('IATA airport code (3 chars), e.g. LAX'),
    to: z.string().length(3).describe('IATA airport code (3 chars), e.g. JFK'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('ISO 8601 date — yyyy-mm-dd'),
    passengers: z.number().int().min(1).max(9).optional().default(1)
      .describe('Number of passengers (default 1)'),
  }),

  // executeIn: 'host' — runs in the browser. The LLM's tool-call event
  // arrives client-side; this handler fires here; the result is sent
  // back to the agent server for the next reasoning turn. Use 'host'
  // when the handler needs the user's browser context (e.g. local
  // storage, a signed user session). Use 'server' when the handler
  // talks to backend services that shouldn't be exposed to the
  // browser — the server-side tool runner picks it up.
  executeIn: 'host',

  handler: async (args, ctx) => {
    // ctx carries: threadId, runId, toolCallId, signal (AbortSignal),
    // startOperation / reportProgress / completeOperation (LRO seam,
    // see step 10).

    try {
      const response = await fetch('/api/flights/book', {
        method: 'POST',
        signal: ctx.signal,
        body: JSON.stringify(args),
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        // Throw — the orchestrator captures the error as
        // `tool_error` on the chat transcript and the LLM gets the
        // message back for its next turn.
        throw new Error(`Flight API returned ${response.status}`);
      }

      const booking = await response.json() as {
        bookingId: string; price: number; airline: string;
      };

      // Generative-UI return shape — `components: [{name, props}]`
      // causes the chat shell to mount the registered widget by name.
      // See step 5 for the widget definition.
      return {
        bookingId: booking.bookingId,
        from: args.from,
        to: args.to,
        date: args.date,
        passengers: args.passengers,
        price: booking.price,
        components: [
          {
            name: 'flightCard',         // matches agenticWidget({ name: 'flightCard' })
            props: {
              bookingId: booking.bookingId,
              from: args.from,
              to: args.to,
              date: args.date,
              price: booking.price,
              airline: booking.airline,
              status: 'confirmed',
            },
          },
        ],
      };
    } catch (err) {
      // Re-throw — orchestrator records it as tool_error.
      throw new Error(`bookFlight failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
});
```

Register it in `src/app/agentic/tools.ts`:

```ts
// src/app/agentic/tools.ts
import type { ToolDef } from '@infra-tools/agentic-ui';
import { bookFlightTool } from './tools/book-flight.tool';

export const tools: ToolDef[] = [
  bookFlightTool,
];
```

**Cross-reference**: [README → Use case 2](../README.md#use-cases) · [`cookbook/extended-registries-feature-tour.md`](./cookbook/extended-registries-feature-tour.md).

---

## Step 5 — Define your first widget

**Goal**: let the LLM render a typed Angular component as part of its reply. See [`CONCEPTS.md → Widget`](./CONCEPTS.md#widget-aka-component--componentdef-registered-in-componentregistry).

```bash
ng g @infra-tools/agentic-ui:widget FlightCard
```

```ts
// src/app/agentic/widgets/flight-card.widget.ts — the registration
import { agenticWidget } from '@infra-tools/agentic-ui';
import { z } from 'zod';
import { FlightCardComponent } from './flight-card.component';

export const flightCardWidget = agenticWidget({
  name: 'flightCard',                // MUST match the tool's components[].name
  component: FlightCardComponent,    // the Angular class below

  // Zod schema validates the props the agent emits. Props that fail
  // validation render with the agent's raw payload; the
  // `agentic.widget.render` telemetry event records `props_parse: 'fallthrough'`
  // so adopters can quantify malformed-props rates.
  propsSchema: z.object({
    bookingId: z.string(),
    from: z.string(),
    to: z.string(),
    date: z.string(),
    price: z.number().nonnegative(),
    airline: z.string().optional(),
    status: z.enum(['confirmed', 'pending', 'cancelled']).default('confirmed'),
  }),

  // Optional — list data sources the widget needs at mount time. The
  // chat shell verifies these are registered in DataSourceRegistry
  // before mounting; missing sources render a no-access stub.
  // dataSources: ['users'],
});
```

```ts
// src/app/agentic/widgets/flight-card.component.ts — the Angular class
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-flight-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card" [class.confirmed]="status() === 'confirmed'">
      <header>
        <h3>✈ {{ from() }} → {{ to() }}</h3>
        <span class="status">{{ status() }}</span>
      </header>
      <dl>
        <dt>Date</dt>           <dd>{{ date() }}</dd>
        <dt>Price</dt>          <dd>\${{ price() }}</dd>
        @if (airline()) {
          <dt>Airline</dt>      <dd>{{ airline() }}</dd>
        }
        <dt>Booking</dt>        <dd><code>{{ bookingId() }}</code></dd>
      </dl>
    </article>
  `,
  styles: `
    .card { padding: 1rem; border: 1px solid #d1d5db; border-radius: 0.5rem; }
    .card.confirmed { border-color: #10b981; }
    header { display: flex; justify-content: space-between; align-items: center; }
    .status { padding: 0.15rem 0.5rem; background: #d1fae5; border-radius: 999px; font-size: 0.75rem; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.2rem 0.5rem; margin: 0.5rem 0 0; }
    dt { color: #6b7280; }
  `,
})
export class FlightCardComponent {
  // Inputs are exposed as Angular's signal-input form. The chat shell
  // passes them via `*ngComponentOutlet`'s `inputs: { ... }` map; each
  // signal updates if the agent re-emits a widget with a different
  // payload.
  readonly bookingId = input.required<string>();
  readonly from = input.required<string>();
  readonly to = input.required<string>();
  readonly date = input.required<string>();
  readonly price = input.required<number>();
  readonly airline = input<string | undefined>();
  readonly status = input<'confirmed' | 'pending' | 'cancelled'>('confirmed');
}
```

Register it:

```ts
// src/app/agentic/widgets.ts
import type { ComponentDef } from '@infra-tools/agentic-ui';
import { flightCardWidget } from './widgets/flight-card.widget';

export const widgets: ComponentDef[] = [
  flightCardWidget,
];
```

Now the LLM calls `bookFlight`; the handler returns `components: [{name: 'flightCard', props}]`; the chat shell looks up `flightCard` in `ComponentRegistry`, validates props against the Zod schema, and mounts `<app-flight-card>` under the tool-result line.

**Cross-reference**: [`cookbook/widgets-with-live-data.md`](./cookbook/widgets-with-live-data.md) for the DataSource pattern (F2).

---

## Step 6 — Run an agent server

**Goal**: HTTP endpoint that returns AG-UI events. Starts with the EchoAgent (no LLM key required) so you can prove the round trip.

```bash
ng g @infra-tools/agentic-ui:agent-server my-agent-server
cd projects/my-agent-server
npm install && npm run dev
```

Boots a Hono server on `:4111` with the EchoAgent at `POST /agents/echo/run`. Reload your app → type "hello" → see it streamed back word-by-word.

The generated files:

```ts
// projects/my-agent-server/src/server.ts — complete
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { agUiRouteHandler } from '@infra-tools/agentic-ui-server';
import { EchoAgent } from './echo-agent';

const app = new Hono();

// CORS for local dev — the browser hosting the chat shell is on a
// different port than this server.
app.use('/*', cors({ origin: 'http://localhost:4200' }));

// Mount the Echo agent at /agents/echo/run.
app.post(
  '/agents/echo/run',
  agUiRouteHandler({ agent: new EchoAgent() }),
);

// Health check.
app.get('/health', (c) => c.text('ok'));

const port = 4111;
console.log(`Agent server listening on http://localhost:${port}`);
serve({ fetch: app.fetch, port });
```

```ts
// projects/my-agent-server/src/echo-agent.ts — complete
import type { ServerAgent, AgenticEvent, AgenticRunInput } from '@infra-tools/agentic-ui-server';

/**
 * Echo agent — streams the user's latest message back word-by-word.
 * Useful for proving the wire works without burning LLM quota.
 */
export class EchoAgent implements ServerAgent {
  async *run(input: AgenticRunInput): AsyncIterable<AgenticEvent> {
    yield { type: 'run-started', threadId: input.threadId, runId: input.runId };

    const lastUserMessage = [...input.messages]
      .reverse()
      .find((m) => m.role === 'user');
    const text = lastUserMessage
      ? (typeof lastUserMessage.content === 'string' ? lastUserMessage.content : '[multipart content]')
      : '(no user message)';

    const words = text.split(/\s+/);
    const messageId = `m-${input.runId}`;

    for (const word of words) {
      if (input.signal.aborted) break;
      yield { type: 'text-delta', messageId, delta: word + ' ' };
      await new Promise((r) => setTimeout(r, 40));     // small pause for streaming feel
    }

    yield { type: 'text-end', messageId };
    yield { type: 'run-finished', runId: input.runId };
  }
}
```

**Cross-reference**: `examples/demo-server` for a reference server hosting six agents (echo, gemini, three specialists, orchestrator) under one process.

---

## Step 7 — Plug in a real LLM

**Goal**: an agent that actually understands prompts.

The lib is LLM-agnostic. Three common paths covered below — Gemini, OpenAI, Anthropic. The pattern is the same: implement `ServerAgent`, call the LLM, translate the LLM's streaming response into `AgenticEvent`s.

### Gemini (free tier — used by all demos)

```bash
npm install @google/generative-ai --prefix projects/my-agent-server
```

```ts
// projects/my-agent-server/src/gemini-agent.ts — complete
import { GoogleGenerativeAI, FunctionDeclarationSchemaType } from '@google/generative-ai';
import type { ServerAgent, AgenticEvent, AgenticRunInput, ToolDef } from '@infra-tools/agentic-ui-server';

export class GeminiAgent implements ServerAgent {
  private readonly client = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY!);

  async *run(input: AgenticRunInput): AsyncIterable<AgenticEvent> {
    yield { type: 'run-started', threadId: input.threadId, runId: input.runId };

    const model = this.client.getGenerativeModel({
      model: 'gemini-2.5-flash',
      tools: input.tools.length > 0
        ? [{ functionDeclarations: this.toGeminiTools(input.tools) }]
        : undefined,
    });

    const chat = model.startChat({
      history: this.toGeminiHistory(input.messages.slice(0, -1)),
    });

    const lastUserMessage = input.messages[input.messages.length - 1];
    const userText = typeof lastUserMessage?.content === 'string'
      ? lastUserMessage.content
      : '[multipart]';

    try {
      const stream = await chat.sendMessageStream(userText);
      const messageId = `m-${input.runId}`;
      let emittedText = false;

      for await (const chunk of stream.stream) {
        if (input.signal.aborted) break;

        const text = chunk.text();
        if (text) {
          yield { type: 'text-delta', messageId, delta: text };
          emittedText = true;
        }

        const functionCalls = chunk.functionCalls();
        if (functionCalls) {
          for (const call of functionCalls) {
            const toolCallId = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            yield { type: 'tool-call-start', toolCallId, name: call.name };
            yield { type: 'tool-call-args', toolCallId, delta: JSON.stringify(call.args) };
            yield { type: 'tool-call-end', toolCallId };
            // Note: the orchestrator runs the host-side handler;
            // the next turn's request comes back with the result
            // attached, and we continue the conversation.
          }
        }
      }

      if (emittedText) yield { type: 'text-end', messageId };
      yield { type: 'run-finished', runId: input.runId };
    } catch (err) {
      yield {
        type: 'run-error',
        runId: input.runId,
        error: {
          code: 'gemini_error',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  private toGeminiTools(tools: readonly ToolDef[]) {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      // `t.parametersSchema` is the JSON-Schema view of the tool's Zod schema.
      parameters: this.jsonSchemaToGemini(t.parametersSchema as { properties?: Record<string, unknown>; required?: string[] }),
    }));
  }

  private jsonSchemaToGemini(schema: { properties?: Record<string, unknown>; required?: string[] }) {
    return {
      type: FunctionDeclarationSchemaType.OBJECT,
      properties: schema.properties ?? {},
      required: schema.required ?? [],
    };
  }

  private toGeminiHistory(messages: AgenticRunInput['messages']) {
    return messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: typeof m.content === 'string' ? m.content : '[multipart]' }],
      }));
  }
}
```

Mount it on the server:

```ts
// projects/my-agent-server/src/server.ts (additions)
import { GeminiAgent } from './gemini-agent';

app.post('/agents/gemini/run', agUiRouteHandler({ agent: new GeminiAgent() }));
```

Update the client:

```ts
// src/app/app.config.ts (change)
provideAgUiBackend({
  url: 'http://localhost:4111/agents/gemini/run',
}),
```

Run with `GOOGLE_GENERATIVE_AI_API_KEY=… npm run dev`. The chat now reasons.

### OpenAI

Same pattern with `openai` SDK; translate `openai.chat.completions.create({ stream: true })` chunks into `text-delta` / `tool-call-*` events. OpenAI's tool-call shape is closest to the canonical wire — `convertToolsToOpenAi` from `_shared/canonical-messages` produces exactly what OpenAI expects.

### Anthropic

Same pattern with `@anthropic-ai/sdk`; translate `client.messages.stream({…})` events. Anthropic's tool blocks emit `tool_use` content blocks — map them to `tool-call-start` / `tool-call-args` / `tool-call-end`.

**Cross-reference**: `examples/demo-ediscovery-server/src/gemini-agent.ts` is a working reference with tool-call handling, system context, and the orchestrator-routing pattern.

---

## Step 8 — Add forms (F1)

**Skip if**: free-text prompts cover your use cases.

```ts
// src/app/agentic/forms/custodian-intake.form.ts — complete
import { agenticForm } from '@infra-tools/agentic-ui';
import { z } from 'zod';

export const custodianIntakeForm = agenticForm({
  name: 'custodianIntake',
  description: 'Onboard a new custodian — collect name, email, department.',

  schema: z.object({
    name: z.string().min(1).describe('Full legal name'),
    email: z.string().email().describe('Work email'),
    department: z.enum(['Engineering', 'Legal', 'Finance', 'Operations'])
      .describe('Department'),
    acknowledgedCompliance: z.boolean().refine((v) => v === true, {
      message: 'Compliance acknowledgement is required',
    }),
  }),

  // Composition allows predicate-gated sections that toggle on partial
  // values (e.g. "if department === 'Engineering', also collect a
  // GitHub handle"). Skip the field for a single flat form.

  onSubmit: async (values) => {
    const response = await fetch('/api/custodians', {
      method: 'POST',
      body: JSON.stringify(values),
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) throw new Error(`Custodian intake failed: ${response.status}`);
    const created = await response.json();
    return {
      ok: true,
      custodianId: created.id,
      message: `${values.name} added to ${values.department}`,
    };
  },
});
```

Register:

```ts
// src/app/app.config.ts
import { custodianIntakeForm } from './agentic/forms/custodian-intake.form';

provideAgenticUi({
  tools,
  widgets,
  forms: [custodianIntakeForm],
}),
```

The agent now picks the form when the user says "onboard a custodian." The form mounts inline; the user fills it; submit calls `onSubmit`; the result flows back into the conversation.

**Cross-reference**: [`cookbook/composable-intake-form.md`](./cookbook/composable-intake-form.md).

---

## Step 9 — Add approvals (F4 — Human-in-the-loop)

**Skip if**: no tool needs senior-reviewer sign-off.

```ts
// src/app/agentic/approvals/release-hold.approval.ts — complete
import { agenticApproval } from '@infra-tools/agentic-ui';

export const releaseHoldApproval = agenticApproval({
  toolName: 'releaseHold',          // gates the tool of this name

  // Persona-gated: paralegals need approval; lead-counsel does not.
  // ctx.persona comes from AGENTIC_ACTIVE_PERSONA (step 13).
  required: (args, ctx) => ctx.persona === 'paralegal',

  signoffMessage: (args) =>
    `Release legal hold ${args.holdId}? This is irreversible. All custodians on this hold will be notified.`,

  // Optional — extra metadata captured on the audit record.
  metadata: (args) => ({
    holdId: args.holdId,
    severity: 'high',
  }),
});
```

Register:

```ts
// src/app/app.config.ts
provideAgenticUi({
  tools,
  widgets,
  forms: [...],
  approvals: [releaseHoldApproval],
}),
```

When the LLM picks `releaseHold` and the user is `paralegal`:
1. The chat-shell intercept queues the approval (`ApprovalRegistry.enqueue(...)`).
2. An `<mvk-approval-card>` mounts inline in the chat with the signoff message + approve/reject buttons.
3. The same approval also surfaces on the `/approvals` route (a senior reviewer can fire from there even if they're not in the chat).
4. On approve, the tool's real handler runs. On reject, the LLM gets a "rejected" result and can apologize / suggest alternatives.

Every transition emits `tool-approved` / `tool-rejected` events that participate in the audit chain.

**Cross-reference**: [`cookbook/approval-flow.md`](./cookbook/approval-flow.md) · [`cookbook/multi-pod-approvals.md`](./cookbook/multi-pod-approvals.md) for cross-replica handoff.

---

## Step 10 — Add long-running operations (F5)

**Skip if**: every tool finishes in <5s.

```ts
// src/app/agentic/tools/run-tar-classifier.tool.ts — complete
import { agenticTool } from '@infra-tools/agentic-ui';
import { z } from 'zod';

export const runTarClassifierTool = agenticTool({
  name: 'runTarClassifier',
  description:
    'Run the TAR (Technology-Assisted Review) classifier against the un-tagged corpus for a topic. ' +
    'Long-running — minutes to hours depending on corpus size.',
  schema: z.object({
    topic: z.string().describe('What to classify for, e.g. "SEC inquiry"'),
    corpusFilter: z.object({
      custodianIds: z.array(z.string()).optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }).optional(),
  }),
  executeIn: 'host',

  // Marks the tool as long-running. The chat shell renders an
  // `<mvk-operation-progress>` widget under the tool result and the
  // tool result returns immediately with `{ status: 'started', opId }`.
  longRunning: true,

  handler: async (args, ctx) => {
    // 1. Open the operation in OperationRegistry. Returns an opId.
    const opId = ctx.startOperation({
      description: `Classifying "${args.topic}"`,
      // Optional — estimated duration helps the progress UI render a
      // smooth bar instead of waiting for the first progress event.
      estDurationMs: 5 * 60_000,
    });

    // 2. Long-running work goes here. Report progress periodically.
    try {
      const total = 1247;
      let processed = 0;

      for (let batch = 0; batch < 25; batch++) {
        // Check the abort signal — user clicked "stop" or backend
        // dropped the connection.
        if (ctx.signal.aborted) {
          ctx.failOperation(opId, { code: 'aborted', message: 'User aborted classification' });
          return { status: 'aborted', opId };
        }

        // Imagine: call your real TAR service in batches.
        await new Promise((r) => setTimeout(r, 200));
        processed += 50;

        ctx.reportProgress(opId, {
          pct: Math.min(100, (processed / total) * 100),
          phase: `batch ${batch + 1} of 25`,
          partialResult: { processedSoFar: processed, total },
        });
      }

      // 3. Complete with the final result.
      return ctx.completeOperation(opId, {
        topic: args.topic,
        total,
        responsive: 312,
        privileged: 84,
        hot: 17,
      });
    } catch (err) {
      ctx.failOperation(opId, {
        code: 'tar_error',
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  },
});
```

**Cross-reference**: [`cookbook/long-running-operations.md`](./cookbook/long-running-operations.md).

---

## Step 11 — Add multi-modal input (F6)

**Skip if**: text-only prompts are enough.

No app-side code needed for the composer side — `<mvk-chat-shell>` auto-exposes the paperclip / drag-drop / paste-image affordances. What you DO need:

1. The active backend must advertise `multiModal: true` in its capabilities.
2. Your agent server's `ServerAgent.run` must handle `AgenticMessage.content: MessageContent[]` (the array shape).

```ts
// projects/my-agent-server/src/gemini-agent.ts — extended for multi-modal
async *run(input) {
  // … same as before …
  const lastMessage = input.messages[input.messages.length - 1];

  if (Array.isArray(lastMessage?.content)) {
    // Multi-modal payload: extract image parts and pass to Gemini's
    // multimodal API.
    const parts = lastMessage.content;
    const geminiParts = parts.map((p) => {
      if (p.kind === 'text') return { text: p.text };
      if (p.kind === 'image') {
        return {
          inlineData: {
            mimeType: p.mimeType,
            data: typeof p.data === 'string' ? p.data.replace(/^data:[^,]+,/, '') : '',
          },
        };
      }
      // File parts: send the filename + uri so the LLM knows what's
      // attached even if it can't read the bytes.
      return { text: `[file: ${p.filename} at ${p.uri}]` };
    });
    // … pass geminiParts to Gemini's generateContentStream … 
  }
  // … rest as before …
}
```

Backends that DON'T advertise `multiModal: true` see the composer auto-fall-back to text-only via `flattenContentToString` — `[image: alt]` and `[file: name]` markers replace the binary parts.

**Cross-reference**: [`cookbook/multi-modal-input.md`](./cookbook/multi-modal-input.md).

---

## Step 12 — Federate capabilities from MFE remotes

**Skip if**: single Angular app.

Multiple teams contribute tools + widgets without recompiling the host. The remote ships a `CapabilityModule`; the host loads it at runtime.

### Remote side — `projects/bookings-remote/src/Capability.ts`

```ts
// Complete CapabilityModule export
import { defineCapabilityModule } from '@infra-tools/agentic-ui';
import { bookFlightTool } from './tools/book-flight.tool';
import { checkBookingTool } from './tools/check-booking.tool';
import { flightCardWidget } from './widgets/flight-card.widget';

export const capability = defineCapabilityModule({
  // Source tag identifies entries for removeBySource teardown.
  source: 'remote:bookings',

  // Optional — host-version-check compatibility (ADR-014).
  requiredHostVersion: '^1.2.0',

  version: '1.0.0',
  tools: [bookFlightTool, checkBookingTool],
  widgets: [flightCardWidget],

  // All other capability surfaces are optional.
  // forms, approvals, operations, dataSources,
  // actions, intents, triggers, dashboards, playbooks.
});

// The capability MUST be the default export OR a `capability` named
// export — both work with the loaders below.
export default capability;
```

### Host side — `src/app/main.ts`

```ts
// Complete federation bootstrap
import { bootstrapApplication, provideAppInitializer } from '@angular/platform-browser';
import { loadRemoteCapabilities, MfeRegistryClient } from '@infra-tools/agentic-ui';
import { loadRemoteModule } from '@angular-architects/native-federation';
import { App } from './app/app';
import { appConfig } from './app/app.config';

const remotes = [
  { remoteName: 'bookings', version: '1.0.0',
    remoteEntry: 'http://localhost:4201/remoteEntry.js' },
  { remoteName: 'loyalty', version: '1.0.0',
    remoteEntry: 'http://localhost:4203/remoteEntry.js' },
];

bootstrapApplication(App, {
  ...appConfig,
  providers: [
    ...appConfig.providers!,
    // Block bootstrap until every remote registers its capabilities.
    provideAppInitializer(async () => {
      await Promise.all(
        remotes.map((remote) =>
          loadRemoteCapabilities({
            remote,
            loader: async (spec) =>
              loadRemoteModule({ remoteName: spec.remoteName, exposedModule: './Capability' }),
          }),
        ),
      );
      console.log(`[host] Loaded ${remotes.length} remotes`);
    }),
  ],
});
```

After bootstrap, the host's `ToolRegistry` + `ComponentRegistry` contain the remote's contributions. The chat shell, the LLM, and the widget container all see them.

### Teardown

```ts
// Imperative unload (e.g. when an admin disables a remote at runtime)
import { ToolRegistry, ComponentRegistry } from '@infra-tools/agentic-ui';

constructor(
  private tools: ToolRegistry,
  private widgets: ComponentRegistry,
) {}

unloadBookings(): void {
  this.tools.removeBySource('remote:bookings');
  this.widgets.removeBySource('remote:bookings');
}
```

`removeBySource` works symmetrically across every registry — one call per registry tears down everything that remote contributed.

**Cross-reference**: [`cookbook/federate-an-mfe.md`](./cookbook/federate-an-mfe.md) · [`cookbook/federation-at-scale.md`](./cookbook/federation-at-scale.md).

---

## Step 13 — Add persona scope filtering

**Skip if**: every user sees every tool.

Three coordinated layers; client filtering is necessary but not sufficient — the server MUST re-validate persona claims on every tool call.

```ts
// src/app/services/persona.service.ts — complete
import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PersonaService {
  // Replace with whatever your auth surface provides.
  private readonly _active = signal<string>('paralegal');
  readonly active = this._active.asReadonly();

  setActive(persona: string): void {
    this._active.set(persona);
  }
}
```

```ts
// src/app/app.config.ts — add the InjectionToken + the scope policy
import { AGENTIC_ACTIVE_PERSONA, ToolRegistry, ComponentRegistry } from '@infra-tools/agentic-ui';
import { PersonaService } from './services/persona.service';
import { inject, provideAppInitializer } from '@angular/core';

export const appConfig: ApplicationConfig = {
  providers: [
    // … (existing providers) …

    // 1. Wire the active-persona signal as a DI token.
    {
      provide: AGENTIC_ACTIVE_PERSONA,
      useFactory: () => inject(PersonaService).active,
    },

    // 2. Install the scope policy on every registry that should respect
    //    persona scoping. App initializer runs after DI is ready.
    provideAppInitializer(() => {
      const persona = inject(PersonaService);
      const tools = inject(ToolRegistry);
      const widgets = inject(ComponentRegistry);

      const policy = (entry: { scopes?: readonly string[] }) => {
        // Entries without explicit scopes are visible to everyone.
        if (!entry.scopes || entry.scopes.length === 0) return true;
        return entry.scopes.includes(persona.active());
      };

      tools.setScopePolicy(policy);
      widgets.setScopePolicy(policy);
    }),
  ],
};
```

Now tag your tools with `scopes`:

```ts
// src/app/agentic/tools/release-hold.tool.ts
export const releaseHoldTool = agenticTool({
  name: 'releaseHold',
  description: 'Release a legal hold. Lead-counsel only.',
  scopes: ['lead-counsel', 'partner'],   // paralegals can't see this
  schema: z.object({ holdId: z.string() }),
  executeIn: 'host',
  handler: async (args) => { /* … */ },
});
```

A `paralegal` running the chat will not see `releaseHold` in the LLM's tool list at all. Combine with step 9's approval policy for layered defense (paralegal can call → approval queue → counsel approves).

**Cross-reference**: [ADR-008](./adr/0008-registry-scope-policy.md) · [`cookbook/context-aware-agent.md`](./cookbook/context-aware-agent.md).

---

## Step 14 — Wire telemetry (OpenTelemetry)

**Skip if**: console logs are enough.

```bash
npm install @opentelemetry/api @opentelemetry/sdk-trace-web @opentelemetry/exporter-trace-otlp-http
```

```ts
// src/app/agentic/telemetry.ts — complete OTel SDK setup
import { trace, metrics } from '@opentelemetry/api';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-web';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const provider = new WebTracerProvider({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'my-agentic-app',
    [ATTR_SERVICE_VERSION]: '1.0.0',
  }),
  spanProcessors: [
    new BatchSpanProcessor(
      new OTLPTraceExporter({ url: 'https://otel-collector.example.com/v1/traces' }),
    ),
  ],
});
provider.register();

export const otelProviders = {
  tracer: trace.getTracer('agentic-ui', '1.2.2'),
  meter: metrics.getMeter('agentic-ui', '1.2.2'),
};
```

```ts
// src/app/app.config.ts (swap console for OTel)
import { provideAgenticTelemetry } from '@infra-tools/agentic-ui';
import { otelProviders } from './agentic/telemetry';

providers: [
  // … (existing) …
  // Replace provideAgenticTelemetryConsole() with:
  provideAgenticTelemetry({
    kind: 'otel',
    providers: otelProviders,
  }),
],
```

The lib now emits every span / event / metric through your OTel provider. Events emitted automatically:
- `agentic.run.start` / `agentic.run.end` (with `duration_ms`, `outcome`)
- `agentic.tool_call.start` / `agentic.tool_call.end` (as spans, so durations + child-span linking works)
- `agentic.widget.render`
- `agentic.federation.load.start` / `…end`
- `agentic.registry.register` / `…remove` / `…dropped` / `…namespaced`
- `agentic.platform.sse.*` / `…capability_authorizer.*` / `…capability_registrar.*`
- `agentic.trigger.fire` / `…error`
- `agentic.run.malformed_event`

W3C `traceparent` propagates across SSE automatically.

**Cross-reference**: [`cookbook/observability.md`](./cookbook/observability.md).

---

## Step 15 — Wire the catalog platform

**Skip if**: no cross-app capability discovery / central audit / ops console.

```ts
// src/app/app.config.ts — complete provideAgenticPlatform wiring
import { provideAgenticPlatform } from '@infra-tools/agentic-ui';

providers: [
  provideZonelessChangeDetection(),
  provideAgenticUi({ tools, widgets, forms, approvals }),
  provideAgUiBackend({ url: environment.agentUrl }),

  // The platform provider — five features, each opt-in. Omit a key
  // to disable that feature. Setting it to `{}` enables defaults.
  provideAgenticPlatform({
    catalogUrl: environment.catalogUrl,        // e.g. https://catalog.example.com
    tenantId: environment.tenantId,            // e.g. 'acme'
    getToken: async () => oidc.getAccessToken(),

    // Feature 1 — IAM persona resolver. Resolves the active persona
    // from the catalog. Replaces the local PersonaService from step 13
    // for apps that integrate with the central IAM.
    personaResolver: {
      defaultPersona: 'paralegal',
      // Optional: per-claim mapping rules.
      // claimMapping: { 'roles[*]': 'persona' },
    },

    // Feature 2 — MFE registry. Discovers remotes from the catalog
    // instead of a static list (replaces the `remotes` array in step 12).
    mfeRegistry: {
      refreshIntervalMs: 30_000,
    },

    // Feature 3 — Capability registrar. Auto-POSTs every locally
    // registered tool + widget to the catalog at boot. Closes the
    // catalog-drift gap.
    capabilityRegistrar: {},

    // Feature 4 — Capability authorizer. Catalog `lifecycle: 'disabled'`
    // toggles hide entries from ToolRegistry + ComponentRegistry reads.
    // Closes the "ops console disable button is decorative" gap.
    capabilityAuthorizer: {},

    // Feature 5 — Usage metering. Every tool call / widget render /
    // federation load posts to /v1/catalogs/{tenant}/usage. Batched flush.
    usageMetering: {
      batchSize: 50,
      flushIntervalMs: 5_000,
    },
  }),
],
```

Each switch can be omitted (skip the feature) or set to `false` (explicitly disable). Apps without `provideAgenticPlatform` see zero behavior change.

**Cross-reference**: [ADRs 031–034](./adr/) · [`audit/2026-05-10-platform-audit.md`](./audit/2026-05-10-platform-audit.md).

---

## Step 16 — Expose tools via MCP

**Skip if**: no Claude Desktop / Cursor / Continue / Zed integration.

Wrap your tool set in an MCP server so any MCP-aware host can call them — outside the browser, outside Angular.

```ts
// projects/my-mcp-server/src/server.ts — complete
import { createMcpServer } from '@infra-tools/agentic-ui-mcp';
import { bookFlightTool, checkBookingTool } from './tools';

async function main() {
  const userId = process.env.USER_ID ?? 'mcp-anonymous';

  const server = createMcpServer({
    name: 'my-agentic-mcp',
    version: '1.0.0',
    tools: [bookFlightTool, checkBookingTool],

    // beforeCall — fires before every tool invocation. Audit-log,
    // authenticate, rate-limit, etc.
    beforeCall: async (toolName, args) => {
      console.error(`[mcp] ${userId} → ${toolName}(${JSON.stringify(args).slice(0, 80)}…)`);
    },

    // afterCall — fires after every tool result (success or failure).
    afterCall: async (toolName, _args, result, err) => {
      if (err) console.error(`[mcp] ${toolName} ERROR:`, err.message);
      else console.error(`[mcp] ${toolName} ok`);
    },
  });

  // stdio transport — for Claude Desktop / Cursor.
  // HTTP transport — for Zed / Continue / cloud deployment.
  await server.connect({ kind: 'stdio' });
  console.error('[mcp] connected over stdio');
}

main().catch((err) => {
  console.error('[mcp] fatal:', err);
  process.exit(1);
});
```

Build + wire into Claude Desktop:

```bash
npm run build
chmod +x dist/server.js
```

```jsonc
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "my-agentic-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/projects/my-mcp-server/dist/server.js"],
      "env": {
        "USER_ID": "alice@example.com"
      }
    }
  }
}
```

Restart Claude Desktop. The tools appear in the MCP tool list and Claude can call them. Tool results — including `components: [{name, props}]` — render as HTML render hints in Claude's chat.

**Cross-reference**: [`cookbook/mcp-server.md`](./cookbook/mcp-server.md) · [`cookbook/paralegal-mcp-review.md`](./cookbook/paralegal-mcp-review.md).

---

## Step 17 — Expose the agent in Teams / M365 Copilot / GitHub Copilot

**Skip if**: Teams + Copilot aren't your distribution surfaces.

Four adapter packages — pick by surface. Reference: [README → adapter decision tree](../README.md#bring-the-agent-to-other-surfaces--four-adapter-packages).

### Teams chat / M365 Copilot (one handler, every channel)

```ts
// projects/my-teams-server/src/server.ts — complete
import express from 'express';
import {
  createM365AgentMiddleware,
  type M365AgentEvent,
} from '@infra-tools/agentic-ui-m365-agents';
import { runAgentTurn } from './agent-loop';

const app = express();
app.post(
  '/api/messages',
  express.json({ limit: '2mb' }),
  createM365AgentMiddleware({
    credentials: {
      appId: process.env.AGENT_APP_ID!,
      appPassword: process.env.AGENT_APP_PASSWORD!,
    },
    handler: async function* ({ activity, identity, signal }) {
      // identity.channelId — 'msteams' | 'm365copilot' | 'directline'
      // Branch UX by channel:
      const richCardsOk = identity.channelId === 'msteams';

      yield { type: 'typing' };

      const reply = await runAgentTurn({
        userId: identity.userId,
        text: activity.text,
        channelId: identity.channelId,
        signal,
      });

      if (richCardsOk && reply.card) {
        yield { type: 'adaptive-card', card: reply.card, summary: reply.text };
      } else {
        yield { type: 'text', text: reply.text };
      }
    },
    skipSignatureVerification: process.env.NODE_ENV !== 'production',
  }),
);

app.listen(3978);
```

`runAgentTurn` is your existing agent loop — same code that powers the in-app chat. Tools + audit chain + persona scope all flow through identically.

### GitHub Copilot Chat (webhook + SSE)

```ts
// projects/my-copilot-skill/src/server.ts — complete
import express from 'express';
import { createCopilotSkillMiddleware } from '@infra-tools/agentic-ui-copilot-skill';

const app = express();
app.post(
  '/copilot/webhook',
  express.raw({ type: 'application/json' }),
  createCopilotSkillMiddleware({
    githubPublicKey: process.env.GITHUB_PUBLIC_KEY!,
    handler: async function* ({ request, identity }) {
      const reply = await runAgentTurn({
        userId: identity.githubUserId,
        text: request.messages.at(-1)?.content ?? '',
      });
      yield { type: 'text', text: reply.text };
    },
  }),
);
app.listen(3000);
```

### M365 Copilot Studio Connector (Power Platform action)

```ts
// projects/my-connector-server/src/server.ts — abridged
import { createCopilotStudioConnector } from '@infra-tools/agentic-ui-copilot-studio-connector';
import { tools } from './tools';

const connector = createCopilotStudioConnector({
  tenantWhitelist: ['tenant-acme', 'tenant-globex'],
  jwksUri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
  audience: process.env.CONNECTOR_AUDIENCE!,
  tools,
});
// connector.generateManifest() → emit OpenAPI 2.0 manifest for Power Platform import
// connector.middleware → mount on /actions
```

**Cross-reference**: [ADR-041](./adr/0041-teams-copilot-external-surfaces.md) · [ADR-042](./adr/0042-copilot-studio-connector.md) · cookbook entries per surface.

---

## Step 18 — Production deployment

**Required at ship.**

### Thread state persistence

Default `ThreadStateStore` is in-memory; for multi-pod deploys swap in Redis or Postgres:

```ts
// projects/my-agent-server/src/server.ts — multi-pod
import { redisThreadStateStore } from '@infra-tools/agentic-ui-server-stores';
import { agUiRouteHandler } from '@infra-tools/agentic-ui-server';

const threadStore = redisThreadStateStore({
  url: process.env.REDIS_URL!,
  // Optional — per-tenant key prefixing
  keyPrefix: (input) => `tenant:${input.tenantId}:thread:`,
  ttlSeconds: 86_400,    // 24h conversation memory
});

app.post(
  '/agents/gemini/run',
  agUiRouteHandler({
    agent: new GeminiAgent(),
    threadStore,
  }),
);
```

### Rate limiting

```bash
npm install hono-rate-limiter --prefix projects/my-agent-server
```

```ts
// projects/my-agent-server/src/server.ts (additions)
import { rateLimiter } from 'hono-rate-limiter';

app.use(
  '/agents/*',
  rateLimiter({
    windowMs: 60_000,
    limit: 30,                          // 30 turns/min per user
    keyGenerator: (c) => c.req.header('x-user-id') ?? c.req.header('x-forwarded-for') ?? 'anon',
    handler: (c) => c.json({ error: 'rate_limited' }, 429),
  }),
);
```

### Secrets

`.env.example` files in `examples/*` document required vars. Never commit real tokens. The repo's `.githooks/pre-commit` blocks the six most-common signatures (Google API keys, OpenAI keys, GitHub PATs, Slack tokens, SSH private keys, GitHub OAuth tokens).

### Deployment artifacts

- [`platform/helm/agentic-platform/`](../platform/helm/agentic-platform/) — production Helm chart (OIDC + multi-AZ Postgres + Ingress + TLS)
- [`platform/docker-compose.yml`](../platform/docker-compose.yml) — local Postgres + catalog + ops-console
- [`platform/render.yaml`](../platform/render.yaml) — Render blueprint (used by `ediscovery-shell.onrender.com`)

**Cross-reference**: [`cookbook/production-deployment.md`](./cookbook/production-deployment.md).

---

## Step 19 — Observability + cost guardrails

**Required at scale.**

### Dashboards to build (from telemetry step 14)

Mapping the lib's emitted events to ops signals:

| Telemetry event | Dashboard / alarm |
|---|---|
| `agentic.run.end` (p50 / p99 duration_ms) | Turn-latency SLO |
| `agentic.tool_call.end` (success rate by tool name) | Tool-error per-tool |
| `agentic.run.malformed_event` | Backend-health alarm (page on rate >1%) |
| `agentic.registry.host_version_mismatch` | Federation drift alarm |
| `agentic.platform.capability_authorizer.refresh_failed` | Catalog availability alarm |
| `agentic.federation.load.start/end` | MFE remote load-time histogram |

### Cost guardrails (per-tenant tool-call quotas)

```ts
// src/app/services/tool-quota.service.ts
import { Injectable, inject } from '@angular/core';
import { ToolRegistry, type ToolDef } from '@infra-tools/agentic-ui';

@Injectable({ providedIn: 'root' })
export class ToolQuotaService {
  private readonly counts = new Map<string, number>();
  private readonly limit = 100;     // per tenant per day
  private readonly tools = inject(ToolRegistry);

  constructor() {
    this.tools.setScopePolicy((entry: ToolDef) => {
      const used = this.counts.get(entry.name) ?? 0;
      return used < this.limit;
    });
  }

  // Call from your tool wrapper / orchestrator hook.
  record(toolName: string): void {
    this.counts.set(toolName, (this.counts.get(toolName) ?? 0) + 1);
  }
}
```

For token-budget enforcement (LLM-side): check `input.messages` token count BEFORE forwarding to the LLM in your `ServerAgent.run` implementation; throw a `run-error` if the conversation exceeds budget.

For per-tool cost-aware approval gates: use step 9's approval policy with `required: (args) => args.estimatedCost > 100`.

---

## Common pitfalls + fixes

| Symptom | Cause | Fix |
|---|---|---|
| Chat composer renders but messages don't send | Backend URL wrong / server not running | Verify `curl localhost:4111/health` returns ok |
| LLM ignores your tool | Description too vague | Front-load: "Use this when…" + an example |
| Widget renders as "unknown widget" stub | Name mismatch between `agenticWidget({name})` and the agent's `components[].name` | Both must match exactly; case-sensitive |
| Federation singleton mismatch (registries empty in host) | Host + remote bundle their own copies of `@infra-tools/agentic-ui` | Add `shareAll: { singleton: true, strictVersion: true }` in your federation config |
| `agentic.run.malformed_event` telemetry firing | Backend yielded an event that doesn't match `agenticEventSchema` | Run `runConformance(backend)` to identify the offending event |
| Tool args wrong type | LLM returned malformed args; Zod rejected | Tool call records `tool_error`; make the schema more constrained / add `.describe()` text |
| Approval card never appears | `required(args, ctx)` returns false | Console-log inside `required` to see the predicate input |
| MCP server doesn't connect | Wrong path in `claude_desktop_config.json` | Use absolute path; check Claude logs |
| Multi-modal images get lost | Backend doesn't advertise `multiModal: true` | Check `BackendCapabilities` and the server-side `ServerAgent` |

---

## How to verify the round trip

Three checks any new app should pass before shipping:

1. **Echo test** — point at the `EchoAgent`; type any message; see it streamed back. Proves chat shell + backend + server + event routing.
2. **Tool test** — point at your real LLM; ask it to call your first tool. Inspect the transcript for `tool-call-start` / `tool-call-args` / `tool-call-end` lines + the handler's return value. Proves Zod-typed dispatch.
3. **Widget test** — return `components: [{name, props}]` from a tool. See the widget mount under the tool result. Proves the `ComponentRegistry` is wired.

If all three pass, every later step (forms, approvals, federation, telemetry, MCP, Teams) is additive — drop them in without disturbing the foundation.

---

## When to deviate from this sequence

- **Multi-agent first** (specialists routed by an orchestrator): skip step 7, go directly to [`cookbook/multi-agent-orchestration.md`](./cookbook/multi-agent-orchestration.md). The orchestrator is its own `ServerAgent` that classifies prompts and forwards to specialist routes.
- **Federation first** (your team builds the host; other teams contribute tools): skip steps 4–5 (your tools live in the remotes); go to step 12. The host's `provideAgenticUi({ tools: [], widgets: [] })` stays empty.
- **MCP-only** (no browser; expose tools to Claude Desktop): skip 1–3, 5–7; step 4 + step 16 only.

---

## Where this guide ends

You should have:
- A running app with chat + at least one tool + at least one widget
- A clear next step from the opt-in table (federation, forms, approvals, telemetry, …)
- A pointer to the right cookbook entry for each next step
- A production-deployment plan (step 18) and an ops plan (step 19)

For the **complete primitive taxonomy** (every named concept, every decision matrix), see [`CONCEPTS.md`](./CONCEPTS.md).

For the **library's full capability inventory**, see [README → Library capability inventory](../README.md#library-capability-inventory).

For the **enterprise eDiscovery flagship** that exercises every load-bearing seam, see [`examples/demo-ediscovery-shell/`](../examples/demo-ediscovery-shell/) and [`USER_GUIDE.md`](./USER_GUIDE.md).
