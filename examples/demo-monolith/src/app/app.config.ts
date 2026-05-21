import { ApplicationConfig, inject, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import {
  provideAgenticTelemetry,
  provideAgenticTelemetryConsole,
  provideAgenticUi,
  provideAgUiBackend,
  provideHashbrownBackend,
  provideA2uiBackend,
  provideMcpUi,
  UI_ACTION_DISPATCHER,
  type UiActionDispatcher,
} from '@infra-tools/agentic-ui';

import { environment } from '../environments/environment';
import { tools, widgets } from './agentic/agentic';
import { UiActionLogService } from './protocols/ui-action-log.service';

function telemetryProvider() {
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
    default: return [];
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

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideAgenticUi({ tools, widgets }),

    // Three backends registered side-by-side; the protocol switcher in
    // app.ts flips the active one via BackendRegistry.setActive(id).
    // AG-UI registers last so it's the default active backend.
    provideHashbrownBackend({ url: `${base}/agents/hashbrown/run` }),
    provideA2uiBackend({ url: `${base}/agents/a2ui/run` }),
    provideAgUiBackend({ url: environment.agentUrl }),

    // Custom A2UI ui-action dispatcher (records into UiActionLogService).
    { provide: UI_ACTION_DISPATCHER, useFactory: uiActionDispatcher },

    // MCP-UI inbound rendering for the showcase section. Inline html
    // (srcdoc) + component-tree need no external origins; the allowlist
    // stays empty (default-deny).
    provideMcpUi(),

    telemetryProvider(),
  ],
};
