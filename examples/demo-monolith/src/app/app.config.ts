import { ApplicationConfig, inject, makeEnvironmentProviders, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection, type EnvironmentProviders } from '@angular/core';
import {
  provideAgenticTelemetry,
  provideAgenticTelemetryConsole,
  provideAgenticUiPlatform,
  provideAgUiBackend,
  provideHashbrownBackend,
  provideA2uiBackend,
  AGENTIC_RUN_STATE_PROVIDER,
  UI_ACTION_DISPATCHER,
  type UiActionDispatcher,
} from '@infra-tools/agentic-ui';

import { environment } from '../environments/environment';
import { tools, widgets, provideDojoApprovals } from './agentic/agentic';
import { UiActionLogService } from './protocols/ui-action-log.service';
import { TravelerContextService } from './agentic/traveler-context.service';

function telemetryProvider(): EnvironmentProviders {
  switch (environment.telemetry) {
    case 'console': return provideAgenticTelemetryConsole();
    case 'otel':    return provideAgenticTelemetry({
      kind: 'otel',
      providers: {
        tracer: {
          startSpan: () => ({ setAttribute: () => {}, recordException: () => {}, end: () => {} }),
        },
      },
    });
    default: return makeEnvironmentProviders([]);
  }
}

// Derive the protocol-server base from the AG-UI url so all three
// reference endpoints share one host (see demo-server's
// reference-protocol-servers.ts for the Hashbrown + A2UI routes).
const base = environment.agentUrl.replace(/\/agents\/.*$/, '');

/**
 * Custom A2UI dispatcher — records ui-action events into
 * `UiActionLogService` so the demo can show them with their live
 * thread/run ids. (The default dispatcher routes to ActionRegistry;
 * this override surfaces the event in the protocol-gallery UI instead.)
 */
const uiActionDispatcher: () => UiActionDispatcher = () => {
  const log = inject(UiActionLogService);
  return {
    dispatch: ({ op, payload, threadId, runId }) => {
      log.record({ op, payload, threadId, runId, at: new Date().toISOString() });
    },
  };
};

// Three backends registered side-by-side so the protocol switcher in
// app.ts can flip the active one via BackendRegistry.setActive(id).
// Bundled as the platform's `transport` with AG-UI LAST so it's the
// default active backend (each provider calls setActive on init).
const transport: EnvironmentProviders = makeEnvironmentProviders([
  provideHashbrownBackend({ url: `${base}/agents/hashbrown/run` }),
  provideA2uiBackend({ url: `${base}/agents/a2ui/run` }),
  provideAgUiBackend({ url: environment.agentUrl }),
]);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),

    // Unified entry point — one call wires tools/widgets, the chat
    // transport, and MCP-UI inbound rendering. MCP-UI needs no external
    // origins for the showcase (inline html + component-tree), so the
    // default-deny allowlist is fine (`mcpUi: true`).
    provideAgenticUiPlatform({
      tools,
      widgets,
      transport,
      mcpUi: true,
      extraProviders: [
        // Custom A2UI ui-action dispatcher (records into UiActionLogService).
        { provide: UI_ACTION_DISPATCHER, useFactory: uiActionDispatcher },
        // Shared state — thread the editable traveler context to the agent
        // on every turn as `AgenticRunInput.state` (ADR-013).
        {
          provide: AGENTIC_RUN_STATE_PROVIDER,
          useFactory: () => {
            const ctx = inject(TravelerContextService);
            return () => ctx.snapshot();
          },
        },
        // Human-in-the-loop: register the redeemPoints approval policy.
        provideDojoApprovals(),
        telemetryProvider(),
      ],
    }),
  ],
};
