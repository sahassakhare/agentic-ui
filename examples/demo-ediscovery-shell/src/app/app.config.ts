import {
  ApplicationConfig,
  EnvironmentInjector,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import {
  provideAgenticTelemetry,
  provideAgenticTelemetryConsole,
  provideAgenticUi,
  provideAgUiBackend,
  ToolRegistry,
} from '@maverick/agentic-ui';

import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { buildTools, registerForms, widgets } from './agentic/agentic';

function telemetryProvider() {
  switch (environment.telemetry) {
    case 'console': return provideAgenticTelemetryConsole();
    case 'otel': return provideAgenticTelemetry({
      kind: 'otel',
      providers: {
        tracer: { startSpan: () => ({ setAttribute: () => {}, recordException: () => {}, end: () => {} }) },
      },
    });
    default: return [];
  }
}

/**
 * Register tools and forms before the chat shell renders. Both factories
 * need an `EnvironmentInjector` because their handlers capture
 * `MatterStore` via `runInInjectionContext`. Widgets are pure data and
 * register through the standard `provideAgenticUi({ widgets })` path.
 */
function bootAgenticCapabilities() {
  return provideAppInitializer(() => {
    const env = inject(EnvironmentInjector);
    registerForms(env);
    inject(ToolRegistry).registerAll(buildTools(env));
  });
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideAgenticUi({ widgets }),
    provideAgUiBackend({ url: environment.agentUrl }),
    telemetryProvider(),
    bootAgenticCapabilities(),
  ],
};
