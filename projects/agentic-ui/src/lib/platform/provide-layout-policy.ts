import { Provider } from '@angular/core';
import {
  ChatShellMode,
  LayoutDensity,
  LayoutPolicy,
  LAYOUT_POLICY,
  DEFAULT_LAYOUT_POLICY,
} from '../layout/types';

/**
 * Per-persona shell-mode + layout-density preferences for the chat shell
 * and workspace-layout primitive. Resolves `<mvk-chat-shell>`'s presentation
 * (rail / pill / overlay / docked-bottom / assist-panel / hidden) per route
 * + per persona, plus a density hint a junior reviewer ↔ partner can use to
 * tune affordance verbosity without forking templates.
 *
 * Two shapes:
 *
 *  - **Single policy:** pass `{ shellMode, density, workspaceLayout? }`
 *    directly when the app has no notion of multiple personas, or when
 *    persona resolution happens elsewhere.
 *
 *  - **Per-persona map:** pass `{ byPersona: { ... }, resolvePersona }` —
 *    the factory dispatches at injection time to the right per-persona
 *    `LayoutPolicy` based on `resolvePersona()`.
 *
 * Apps that don't call `provideLayoutPolicy` get `DEFAULT_LAYOUT_POLICY`
 * (rail mode, comfortable density) via the `LAYOUT_POLICY` token's
 * `providedIn: 'root'` factory. Existing `<mvk-chat-shell />` consumers
 * see no change. ADR-010 D4 zero-breaking-changes holds.
 *
 * @see [ADR-043 D4](../../../../docs/adr/0043-layout-registry-promotion.md#d4--setlayoutpolicypersona-on-registrybase-parallel-to-setscopepolicy)
 *
 * @example
 * ```ts
 * // Single policy
 * provideLayoutPolicy({
 *   shellMode: (route) => route.startsWith('/holds') ? 'pill' : 'rail',
 *   density: () => 'comfortable',
 * });
 *
 * // Per-persona map
 * provideLayoutPolicy({
 *   resolvePersona: () => inject(ACTIVE_PERSONA)(),
 *   byPersona: {
 *     paralegal: { density: 'comfortable', shellMode: r => r.startsWith('/holds') ? 'pill' : 'rail' },
 *     partner:   { density: 'compact',     shellMode: () => 'rail' },
 *     reviewer:  { density: 'dense',       shellMode: r => r.startsWith('/documents/') ? 'pill' : 'rail' },
 *   },
 * });
 * ```
 */
export type LayoutPolicyInput =
  | LayoutPolicySingleInput
  | LayoutPolicyPerPersonaInput;

export interface LayoutPolicySingleInput {
  readonly shellMode?: (route: string) => ChatShellMode;
  readonly density?: () => LayoutDensity;
  readonly workspaceLayout?: (route: string) => string | null;
}

export interface LayoutPolicyPerPersonaInput {
  readonly resolvePersona: () => string | null | undefined;
  readonly byPersona: Readonly<Record<string, LayoutPolicySingleInput>>;
  /** Used when `resolvePersona()` returns a value not in `byPersona`. */
  readonly fallback?: LayoutPolicySingleInput;
}

/**
 * Wire a `LayoutPolicy` into the active persona's chat-shell presentation.
 * Purely additive — call from `app.config.ts` providers list (or nest
 * inside `provideAgenticPlatform` once the composite provider supports
 * layout-policy slots).
 */
export function provideLayoutPolicy(input: LayoutPolicyInput): Provider {
  return {
    provide: LAYOUT_POLICY,
    useFactory: () => buildPolicy(input),
  };
}

function buildPolicy(input: LayoutPolicyInput): LayoutPolicy {
  if ('byPersona' in input) {
    return buildPerPersonaPolicy(input);
  }
  return buildSinglePolicy(input);
}

function buildSinglePolicy(input: LayoutPolicySingleInput): LayoutPolicy {
  const policy: LayoutPolicy = {
    shellMode: input.shellMode ?? DEFAULT_LAYOUT_POLICY.shellMode,
    density: input.density ?? DEFAULT_LAYOUT_POLICY.density,
  };
  if (input.workspaceLayout) {
    return { ...policy, workspaceLayout: input.workspaceLayout };
  }
  return policy;
}

function buildPerPersonaPolicy(input: LayoutPolicyPerPersonaInput): LayoutPolicy {
  // Resolve per-call so persona switches inside the app re-evaluate.
  // Reads stay cheap: shellMode/density are plain function calls on each
  // chat-shell render, not signal subscriptions.
  const pick = (): LayoutPolicy => {
    const persona = input.resolvePersona();
    const match = (persona && input.byPersona[persona]) || input.fallback;
    return match ? buildSinglePolicy(match) : DEFAULT_LAYOUT_POLICY;
  };
  return {
    shellMode: (route) => pick().shellMode(route),
    density: () => pick().density(),
    workspaceLayout: (route) => pick().workspaceLayout?.(route) ?? null,
  };
}
