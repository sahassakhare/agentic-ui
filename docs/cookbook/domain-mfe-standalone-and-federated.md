# Domain MFEs that are simultaneously standalone apps and capability providers

A common confusion when first building agentic MFEs: are the remotes *apps*
or *libraries*? The answer is **both**. Each domain MFE is a real Angular
application that ships:

1. **Its own UI** (route table, components, forms) — a normal app for users
   who navigate to that team's URL directly, and
2. **An exposed `Capability` module** that the agentic-UI host pulls in via
   federation, contributing tools and widgets to the host's chat experience.

The two surfaces share the same handler code and the same widget components.
Nothing is forked. This is what makes "agentic UI in an MFE world"
sustainable for a real organisation: each domain team owns one codebase,
and the chat-driven path is *one consumer* among many.

## What this looks like in the demo

The repo's three remotes (`demo-remote-bookings`, `demo-remote-loyalty`,
`demo-remote-support`) all follow this pattern. Take the bookings remote
as the canonical example:

```
examples/demo-remote-bookings/
  src/app/
    app.ts                          ← standalone domain UI (form + widget)
    capability.ts                   ← federation entrypoint (tools + widgets)
    tools/
      book-flight.tool.ts           ← handler used by both surfaces
    widgets/
      flight-card.component.ts      ← widget used by both surfaces
      flight-card.widget.ts         ← agenticWidget() registration
```

`app.ts` (the standalone UI) imports and uses the same files `capability.ts`
re-exports as a federation surface:

```ts
// app.ts — standalone UI
import { FlightCardComponent } from './widgets/flight-card.component';
import { bookFlightTool } from './tools/book-flight.tool';

@Component({
  imports: [FormsModule, FlightCardComponent],
  template: `
    <form (ngSubmit)="book()">…</form>
    @if (booking()) { <app-flight-card …/> }
  `,
})
export class App {
  async book() {
    const result = await bookFlightTool.handler({...}, standaloneToolContext());
    this.booking.set(result);
  }
}
```

```ts
// capability.ts — federation surface
import { defineCapabilityModule } from '@maverick/agentic-ui';
import { bookFlightTool } from './tools/book-flight.tool';
import { flightCardWidget } from './widgets/flight-card.widget';

export const capability = defineCapabilityModule({
  remoteName: 'demo-remote-bookings',
  version: '1.0.0',
  tools: [bookFlightTool],
  components: [flightCardWidget],
});
```

The host shell at `:4200` imports `./Capability` — federation pulls in the
**same** `bookFlightTool` and the **same** `FlightCardComponent` that
`app.ts` uses locally.

## Three places this matters

### 1. Refactors stay safe

A change to `bookFlightTool.handler` or `FlightCardComponent` automatically
flows to both surfaces. There's no "agent version" of the booking flow
that quietly drifts from the user-facing UI.

### 2. Onboarding is honest

A new engineer joining the bookings team can run `ng serve
demo-remote-bookings` and see a working app — no agent infrastructure
required. The agentic capability is a *layer*, not a precondition.

### 3. Federation cost stays bounded

Because the standalone UI lives in the same project as the capability,
there's no extra package to publish, no shared-package version skew to
manage. The remote ships one bundle; the host pulls one chunk.

## ToolContext for direct calls

Tool handlers normally run inside the agent's run-orchestrator, which
provides a real `ToolContext` (thread id, run id, tool-call id, abort
signal). When you call a handler directly from a standalone UI, synthesise
a minimal context:

```ts
function standaloneToolContext() {
  const id = `standalone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    threadId: 'standalone',
    runId: id,
    toolCallId: id,
    signal: new AbortController().signal,
  };
}
```

Demo handlers don't read from the context, so anything stable works. In
production handlers that DO depend on context (e.g., for telemetry
correlation), thread real ids through from your domain UI's request flow.

## Try it

```bash
# Run all three remotes (and the host shell, in the federated quickstart)
npx ng serve demo-remote-bookings   # :4201
npx ng serve demo-remote-loyalty    # :4203
npx ng serve demo-remote-support    # :4205
npx ng serve demo-shell             # :4200
```

| URL | Path | What you see |
|---|---|---|
| <http://localhost:4201> | Standalone UI | Form-driven flight booking; renders `FlightCardComponent` |
| <http://localhost:4203> | Standalone UI | Check balance + redeem points; renders `PointsCardComponent` |
| <http://localhost:4205> | Standalone UI | Open + check tickets; renders `TicketCardComponent` |
| <http://localhost:4200> | Federated host | Same widgets, this time triggered by the orchestrator chat |

The components in the chat are the same class identity as the components
on the standalone pages — open Angular DevTools at `:4200` and at `:4201`
and inspect a flight card; both will show `FlightCardComponent` from
`examples/demo-remote-bookings/src/app/widgets/flight-card.component.ts`.

## When NOT to do this

If a domain has *no meaningful UI of its own* (e.g., a back-office tool
that exists purely to be invoked by an agent), there's no reason to
fabricate a standalone page. Ship just `capability.ts` and skip the
`app.ts` UI. The federation surface is the same; the placeholder Angular
landing page is fine for that case.
