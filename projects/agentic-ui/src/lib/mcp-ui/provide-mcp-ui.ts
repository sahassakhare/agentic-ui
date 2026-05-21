import {
  inject,
  makeEnvironmentProviders,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import { MCP_UI_CONFIG, MCP_UI_DEFAULT_CONFIG, type McpUiConfig } from './config';
import { McpUiActionBridge } from './mcp-ui-action-bridge';

/**
 * Wires MCP-UI inbound rendering. Optional — apps that don't render
 * MCP-UI resources never call this and pay nothing.
 *
 * @example
 * ```ts
 * import { provideMcpUi } from '@infra-tools/agentic-ui';
 * import { inject } from '@angular/core';
 * import { Router } from '@angular/router';
 *
 * providers: [
 *   provideMcpUi({
 *     allowedOrigins: ['https://widgets.example.com'],
 *     // navigate wired so `link` actions can route in-app:
 *     navigate: () => { const r = inject(Router); return (url) => r.navigateByUrl(url); },
 *   }),
 * ],
 * ```
 *
 * Security defaults are strict (empty origin allowlist, `allow-scripts`-only
 * sandbox). See ADR-049 for the trust model.
 */
export interface ProvideMcpUiOptions extends Partial<McpUiConfig> {
  /**
   * Optional factory returning a navigate callback. Runs in an injection
   * context so it can `inject(Router)`. Keeps the lib core free of an
   * `@angular/router` dependency while letting `link` actions route in-app.
   */
  readonly navigate?: () => (url: string) => void;
}

export function provideMcpUi(options: ProvideMcpUiOptions = {}): EnvironmentProviders {
  const { navigate, ...configOverrides } = options;
  const config: McpUiConfig = {
    ...MCP_UI_DEFAULT_CONFIG,
    ...configOverrides,
  };

  return makeEnvironmentProviders([
    { provide: MCP_UI_CONFIG, useValue: config },
    provideEnvironmentInitializer(() => {
      if (!navigate) return;
      const bridge = inject(McpUiActionBridge);
      bridge.setNavigator(navigate());
    }),
  ]);
}
