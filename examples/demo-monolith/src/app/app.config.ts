import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import {
  provideAgenticTelemetry,
  provideAgenticTelemetryConsole,
  provideAgenticUi,
  provideAgUiBackend,
} from '@maverick/agentic-ui';

import { environment } from '../environments/environment';
import { tools, widgets } from './agentic/agentic';

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

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideAgenticUi({ tools, widgets }),
    provideAgUiBackend({ url: environment.agentUrl }),
    telemetryProvider(),
  ],
};
