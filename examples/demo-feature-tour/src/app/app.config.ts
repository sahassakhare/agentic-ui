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
import { buildTools, registerExtendedCapabilities, widgets } from './agentic/agentic';

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
 * App initializer that registers everything in `agentic.ts` *before*
 * the chat shell renders. Using `provideAppInitializer` (not
 * `provideEnvironmentInitializer`) so the returned promise is awaited —
 * a fast-and-loose registration would let the user send a prompt
 * before the registries are populated.
 */
function bootAgenticCapabilities() {
  return provideAppInitializer(() => {
    const env = inject(EnvironmentInjector);
    registerExtendedCapabilities(env);
    inject(ToolRegistry).registerAll(buildTools(env));
  });
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    // Widgets are pure data → safe to register at module init via the
    // standard provider. Tools / actions / forms / data sources need an
    // injection context (they capture services), so they're registered
    // in `bootAgenticCapabilities` below.
    provideAgenticUi({ widgets }),
    provideAgUiBackend({ url: environment.agentUrl }),
    telemetryProvider(),
    bootAgenticCapabilities(),
  ],
};
