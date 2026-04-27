# Federate an MFE (Native Federation)

Goal: a host shell loads a remote MFE at runtime; the remote contributes tools and widgets to the host's chat.

## Host side

```bash
npx ng generate application demo-shell --routing=true
npx ng generate @angular-architects/native-federation:init --project=demo-shell --type=dynamic-host --port=4200
ng add @maverick/agentic-ui --project=demo-shell --skip-install=true
```

Edit `examples/demo-shell/public/federation.manifest.json`:

```json
{ "demo-remote-bookings": "http://localhost:4201/remoteEntry.json" }
```

Edit `examples/demo-shell/src/app/app.config.ts`:

```ts
import { provideEnvironmentInitializer, EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import { loadRemoteModule } from '@angular-architects/native-federation';
import { loadRemoteCapabilities, type CapabilityModule } from '@maverick/agentic-ui/mfe';

function loadDemoRemote() {
  return provideEnvironmentInitializer(() => {
    const injector = inject(EnvironmentInjector);
    void runInInjectionContext(injector, () =>
      loadRemoteCapabilities({
        remote: { remoteName: 'demo-remote-bookings', version: '1.0.0', remoteEntry: 'http://localhost:4201/remoteEntry.json' },
        loader: async () => {
          const mod = await loadRemoteModule<{ capability: CapabilityModule }>({
            remoteName: 'demo-remote-bookings',
            exposedModule: './Capability',
          });
          return { capability: mod.capability };
        },
      }),
    );
  });
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideAgenticUi(),
    provideAgUiBackend({ url: 'http://localhost:4111/agents/echo/run' }),
    loadDemoRemote(),
  ],
};
```

## Remote side

```bash
npx ng generate application demo-remote-bookings
npx ng generate @angular-architects/native-federation:init --project=demo-remote-bookings --type=remote --port=4201
ng g @maverick/agentic-ui:tool bookFlight --project=demo-remote-bookings
ng g @maverick/agentic-ui:widget FlightCard --project=demo-remote-bookings
ng g @maverick/agentic-ui:mfe-capability demo-remote-bookings --project=demo-remote-bookings
```

The `mfe-capability` schematic generates `src/app/capability/capability.ts` with `defineCapabilityModule({...})`. Edit it to import your tool + widget:

```ts
import { defineCapabilityModule } from '@maverick/agentic-ui/mfe';
import { bookFlightTool } from '../agentic/tools/book-flight.tool';
import { flightCardWidget } from '../agentic/widgets/flight-card.widget';
import type { ToolDef } from '@maverick/agentic-ui';

export const capability = defineCapabilityModule({
  remoteName: 'demo-remote-bookings',
  version: '1.0.0',
  tools: [bookFlightTool as ToolDef],
  components: [flightCardWidget],
});
```

Update `examples/demo-remote-bookings/federation.config.js`:

```js
exposes: {
  './Capability': './examples/demo-remote-bookings/src/app/capability/capability.ts',
},
```

## Run

```bash
# Terminal 1 — agent server
cd examples/demo-server && npm run dev

# Terminal 2 — remote
npx ng serve demo-remote-bookings  # http://localhost:4201

# Terminal 3 — host
npx ng serve demo-shell             # http://localhost:4200
```

## Verify the handoff

Open http://localhost:4200 and check:

- The header reads `Capabilities: 1 tool(s) across 1 remote(s): demo-remote-bookings`.
- DevTools → Network shows `remoteEntry.json` and `Capability.js` fetched from `:4201`.
- Asking the agent "book a flight from LAX to JFK" triggers a tool call to `bookFlight`, executed in the remote's injector context.

## Webpack Module Federation

Identical pattern, but use `@angular-architects/module-federation` (interactive `init` schematic — must run in a TTY) and the `/mfe-module-federation` import path:

```ts
import { loadRemoteCapabilitiesMF } from '@maverick/agentic-ui/mfe-module-federation';
import { loadRemote, init } from '@module-federation/runtime';

init({ name: 'demo-shell-mf', remotes: [...] });
const remote = await loadRemoteCapabilitiesMF({
  remote: { remoteName: 'demo-remote-loyalty', version: '1.0.0', remoteEntry: '...' },
  loadRemote,
  exposedModule: './Capability',
});
```

## Try it

After running the host on `:4200` plus at least one remote (`:4201` for bookings):

> *"Book a flight from LAX to JFK on 2026-05-05"*

The chat shell renders the `flightCard` widget shipped from the remote's bundle. The header reads `Capabilities: 1 tool(s) across 1 remote(s): demo-remote-bookings`. To exercise the live-update path (kill a remote and watch the registry shrink), the cross-domain prompts, and the keyword-fallback router, see [Sample prompts](./sample-prompts.md).
