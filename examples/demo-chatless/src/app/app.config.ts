import {
  ApplicationConfig,
  makeEnvironmentProviders,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import {
  provideAgenticUiPlatform,
  provideAgUiBackend,
} from '@infra-tools/agentic-ui';
import { sharedTools } from '@infra-tools/demo-shared-tools';

import { composerTools } from './agentic/composer-tools';
import { accountTools } from './agentic/account-tools';
import { widgets } from './widgets/widgets';

/**
 * Default agent endpoint — the bundled `examples/demo-server` running
 * locally. The single-domain `gemini` agent has access to the same shared
 * tools the chatless UI dispatches against, so a task like
 * "Book a flight from LAX to JFK on 2026-06-15" routes to `bookFlight`,
 * the tool result comes back over AG-UI SSE, and `<mvk-widget-container>`
 * resolves `flightCard` from the host's `ComponentRegistry` and renders it.
 *
 * No `<mvk-chat-shell>` is mounted — `injectAgenticChat()` drives the
 * same run loop programmatically.
 */
const AGENT_URL = 'http://localhost:4111/agents/gemini/run';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),

    // One call wires tools + widgets + transport. The transport here is
    // just AG-UI — the chatless demo isn't a protocol switcher.
    provideAgenticUiPlatform({
      tools: [...sharedTools, ...composerTools, ...accountTools],
      widgets,
      transport: makeEnvironmentProviders([
        provideAgUiBackend({ url: AGENT_URL }),
      ]),
    }),
  ],
};

export { AGENT_URL };
