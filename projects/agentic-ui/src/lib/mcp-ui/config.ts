import { InjectionToken } from '@angular/core';

/**
 * Configuration for MCP-UI inbound rendering. Provided via
 * `provideMcpUi({…})`. The defaults are deliberately strict — an
 * empty `allowedOrigins` means `text/uri-list` resources (external
 * URLs) are refused; only inline `text/html` (srcdoc, no external
 * origin) renders. Adopters opt into external origins explicitly.
 *
 * See ADR-049 for the security model.
 */
export interface McpUiConfig {
  /**
   * Origins allowed for `text/uri-list` (external-URL) resources.
   * Exact-match against the URL's origin. Empty = deny all external
   * URLs (inline HTML still renders). Use `['*']` to allow any origin
   * (NOT recommended outside trusted-server deployments).
   */
  readonly allowedOrigins: readonly string[];
  /**
   * `sandbox` attribute applied to the resource iframe. Default is
   * `'allow-scripts'` only — no same-origin, no top navigation, no
   * forms. Adopters widen deliberately. `allow-same-origin` is
   * intentionally OFF by default: combined with `allow-scripts` it
   * would let the frame escape the sandbox.
   */
  readonly iframeSandbox: string;
  /**
   * Optional handler for actions the library doesn't yet dispatch
   * first-class (`intent`, `notify`, `prompt` in Phase 1). Receives
   * the validated action so adopters can wire them today.
   */
  readonly onUnhandledAction?: (action: import('./types').McpUiAction) => void;
}

export const MCP_UI_DEFAULT_CONFIG: McpUiConfig = {
  allowedOrigins: [],
  iframeSandbox: 'allow-scripts',
};

export const MCP_UI_CONFIG = new InjectionToken<McpUiConfig>('MCP_UI_CONFIG', {
  providedIn: 'root',
  factory: () => MCP_UI_DEFAULT_CONFIG,
});
