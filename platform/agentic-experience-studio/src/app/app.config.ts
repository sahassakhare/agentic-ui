import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideAgenticUiPlatform, provideAgUiBackend } from '@infra-tools/agentic-ui';
import { routes } from './app.routes';
import { authInterceptor } from './interceptors/auth.interceptor';
import { authoringTools } from './copilot/authoring-tools';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor])),
    // Angular Material components (adopted incrementally per
    // docs/material-adoption.md) require the animations provider.
    provideAnimationsAsync(),
    // In-Studio authoring copilot: the platform's own agentic UI, with client-side
    // authoring tools and a real AG-UI backend. Gated at render by the
    // `aiAssistedAuthoring` flag (see CopilotRailComponent + the top-bar toggle).
    provideAgenticUiPlatform({
      tools: authoringTools,
      transport: provideAgUiBackend({ url: environment.agentUrl }),
      mcpUi: false,
    }),
  ],
};
