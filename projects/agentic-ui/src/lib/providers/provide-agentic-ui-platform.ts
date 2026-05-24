import { makeEnvironmentProviders, type EnvironmentProviders, type Provider } from '@angular/core';
import type { ComponentDef, ToolDef } from '../types/registry-defs';
import { provideAgenticUi } from './provide-agentic-ui';
import { provideMcpUi, type ProvideMcpUiOptions } from '../mcp-ui/provide-mcp-ui';

/**
 * Unified entry point for an agentic-ui application — a thin composition
 * facade over the existing `provide*` functions (it never reimplements
 * them). One call wires every surface the app uses:
 *
 *   - **tools / widgets** → {@link provideAgenticUi} (ToolRegistry / ComponentRegistry)
 *   - **transport** → the ONE active chat backend (Axis 1, mutually
 *     exclusive): pass the result of `provideAgUiBackend(...)`,
 *     `provideHashbrownBackend(...)`, or `provideA2uiBackend(...)`.
 *   - **mcpUi** → {@link provideMcpUi} inbound MCP-UI rendering (Axis 2).
 *   - **webMcp** → WebMCP browser tool exposure (Axis 2). Pass the result
 *     of `provideWebMcp(...)` from `@infra-tools/agentic-ui-webmcp`. It is
 *     a **pass-through** rather than a config object so this package does
 *     not depend on the webmcp sibling (the dependency runs the other way).
 *
 * Tool exposure / UI surfaces (mcpUi, webMcp) are orthogonal and may all
 * be active at once; the transport is the single active conversation
 * loop. See docs/plans/unified-agentic-protocol-interface-plan.md.
 *
 * Every sub-provider remains independently callable — existing configs
 * that compose `provideAgenticUi` + `provideAgUiBackend` + … by hand keep
 * working unchanged. The Node `createMcpServer` is intentionally NOT part
 * of this facade (separate process); it consumes the same shared tool
 * source.
 *
 * @example
 * ```ts
 * providers: [
 *   provideAgenticUiPlatform({
 *     tools, widgets,
 *     transport: provideAgUiBackend({ url: '/api/ag-ui' }),
 *     mcpUi: true,                          // or { allowedOrigins: [...] }
 *     webMcp: provideWebMcp({ tools }),     // from @infra-tools/agentic-ui-webmcp
 *   }),
 * ],
 * ```
 *
 * @remarks Name note: `provideAgenticPlatform` (in `lib/platform/`) is a
 * DIFFERENT provider for catalog/IAM/MFE concerns — do not confuse them.
 */
export interface AgenticUiPlatformConfig {
  /** Tool definitions registered as the `host` source at boot. */
  readonly tools?: readonly ToolDef[];
  /** Widget (component) definitions registered as the `host` source at boot. */
  readonly widgets?: readonly ComponentDef[];
  /**
   * The single active chat transport (Axis 1). Build it with one of the
   * backend providers and pass the result here.
   */
  readonly transport: EnvironmentProviders;
  /**
   * Inbound MCP-UI rendering. `true` enables it with strict defaults;
   * pass {@link ProvideMcpUiOptions} to configure; omit / `false` to skip.
   */
  readonly mcpUi?: ProvideMcpUiOptions | boolean;
  /**
   * WebMCP browser tool exposure — pass the result of `provideWebMcp(...)`.
   * Omit to skip. Kept as a pass-through to avoid a dependency from this
   * package onto `@infra-tools/agentic-ui-webmcp`.
   */
  readonly webMcp?: EnvironmentProviders;
  /**
   * Escape hatch: any additional providers (plain `Provider`s or
   * `EnvironmentProviders`) to fold into the platform — e.g. a custom
   * `UI_ACTION_DISPATCHER` or a telemetry provider.
   */
  readonly extraProviders?: ReadonlyArray<Provider | EnvironmentProviders>;
}

export function provideAgenticUiPlatform(config: AgenticUiPlatformConfig): EnvironmentProviders {
  const parts: Array<Provider | EnvironmentProviders> = [
    provideAgenticUi({ tools: config.tools, widgets: config.widgets }),
    config.transport,
  ];

  if (config.mcpUi) {
    parts.push(provideMcpUi(config.mcpUi === true ? {} : config.mcpUi));
  }
  if (config.webMcp) {
    parts.push(config.webMcp);
  }
  if (config.extraProviders?.length) {
    parts.push(...config.extraProviders);
  }

  return makeEnvironmentProviders(parts);
}
