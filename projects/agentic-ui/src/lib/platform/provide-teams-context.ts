import {
  ENVIRONMENT_INITIALIZER,
  InjectionToken,
  Injector,
  Provider,
  Signal,
  inject,
  runInInjectionContext,
  signal,
} from '@angular/core';

/**
 * Teams Tab integration seam (plan P0 / ADR-041 D4).
 *
 * Adopters embedding a `@infra-tools/agentic-ui` host as a Microsoft
 * Teams Tab use this provider to bridge the Teams JS SDK's
 * `microsoftTeams.app.getContext()` into a signal the rest of the
 * runtime tier reads through. We deliberately keep this lib free of
 * a hard dependency on `@microsoft/teams-js`:
 *
 *   - The SDK changes faster than the lib's release cadence.
 *   - Many adopters embed via plain iframe + URL params and don't
 *     want a 60kb SDK in their bundle.
 *   - SSR + Node-side render paths don't have `window.parent`.
 *
 * Instead, adopters pass a `loadContext: () => Promise<TeamsContext>`
 * function. The lib calls it once at bootstrap and exposes the
 * result as `inject(TEAMS_CONTEXT)` (a signal). Production adopters
 * pass `() => microsoftTeams.app.getContext()`; tests pass a
 * deterministic fixture.
 *
 * `provideTeamsContext` is purely additive (ADR-010 D4); apps that
 * don't import it pay nothing.
 *
 * @example
 * ```ts
 * import * as microsoftTeams from '@microsoft/teams-js';
 * await microsoftTeams.app.initialize();
 *
 * provideAgenticPlatform({
 *   providers: [
 *     provideTeamsContext({
 *       loadContext: () => microsoftTeams.app.getContext().then((c) => ({
 *         tenantId: c.user?.tenant?.id ?? '',
 *         userPrincipalName: c.user?.userPrincipalName ?? null,
 *         theme: c.app?.theme ?? 'default',
 *         locale: c.app?.locale ?? 'en-US',
 *       })),
 *     }),
 *   ],
 * });
 * ```
 */
export interface TeamsContext {
  /** AAD tenant id of the Teams user. Maps to the catalog tenant. */
  readonly tenantId: string;
  /** UPN like 'alice@contoso.com'. Null when Teams didn't surface
   *  it (e.g. anonymous tab preview). */
  readonly userPrincipalName: string | null;
  /** Teams theme — bind to the host's CSS theme switcher. */
  readonly theme: 'default' | 'dark' | 'contrast';
  /** Locale identifier like 'en-US'. */
  readonly locale: string;
  /** Free-form claims the host can pass through (group ids, role
   *  hints, etc.). Catalog `role-mappings` keys on these. */
  readonly claims?: Readonly<Record<string, unknown>>;
}

export interface ProvideTeamsContextConfig {
  /**
   * Async function that returns the current Teams context. Called
   * once at bootstrap. Errors are caught + logged; the signal stays
   * `null` so dependents can render a graceful fallback.
   */
  readonly loadContext: () => Promise<TeamsContext>;
  /** Optional fallback used when `loadContext` throws or returns
   *  null. Helpful for local dev outside Teams. */
  readonly fallback?: TeamsContext;
}

/**
 * Signal of the current Teams context. Null until `loadContext`
 * resolves; null forever if `loadContext` throws and no
 * `fallback` was supplied.
 *
 * @remarks
 * Inject this token in components or services that need to react
 * to the Teams context — read inside `computed()` or `effect()`
 * for reactive updates. The null branch is the "not framed by
 * Teams" surface, so always handle it.
 *
 * @example
 * ```ts
 * @Component({...})
 * export class HeaderComponent {
 *   private readonly teams = inject(TEAMS_CONTEXT);
 *   protected readonly tenant = computed(() => this.teams()?.tenantId ?? 'demo');
 *   protected readonly theme  = computed(() => this.teams()?.theme   ?? 'default');
 * }
 * ```
 */
export const TEAMS_CONTEXT = new InjectionToken<Signal<TeamsContext | null>>('TEAMS_CONTEXT');

/**
 * Register a Teams Tab context bridge. Drop into
 * `ApplicationConfig.providers` (or any `provideX(...)` chain).
 * Calls `loadContext` once via `ENVIRONMENT_INITIALIZER`,
 * populates the {@link TEAMS_CONTEXT} signal asynchronously.
 *
 * @param config - Provider config. Required: `loadContext` — an
 *   async function that returns the current
 *   {@link TeamsContext}. Optional: `fallback` — seeds the signal
 *   synchronously and keeps it populated when `loadContext`
 *   rejects.
 * @returns Angular providers ready to spread into a `providers`
 *   array.
 *
 * @remarks
 * - SSR-safe. `loadContext` runs once on the platform that
 *   instantiates the injector; hosts that don't have access to
 *   `microsoftTeams` (Node, prerender) should detect that and
 *   reject so the fallback takes over.
 * - Tree-shakeable. Adopters who never call `provideTeamsContext`
 *   ship no Teams code paths.
 * - The factory does **not** import `@microsoft/teams-js`. Hosts
 *   call the SDK themselves (often lazy) and pass an adapter
 *   function.
 *
 * @example
 * ```ts
 * // app.config.ts
 * import { provideTeamsContext } from '@infra-tools/agentic-ui';
 *
 * export const appConfig: ApplicationConfig = {
 *   providers: [
 *     provideTeamsContext({
 *       loadContext: async () => {
 *         const teams = await import('@microsoft/teams-js');
 *         await teams.app.initialize();
 *         const c = await teams.app.getContext();
 *         return {
 *           tenantId: c.user?.tenant?.id ?? '',
 *           userPrincipalName: c.user?.userPrincipalName ?? null,
 *           theme: c.app?.theme ?? 'default',
 *           locale: c.app?.locale ?? 'en-US',
 *         };
 *       },
 *       fallback: {
 *         tenantId: 'demo',
 *         userPrincipalName: null,
 *         theme: 'default',
 *         locale: 'en-US',
 *       },
 *     }),
 *   ],
 * };
 * ```
 */
export function provideTeamsContext(config: ProvideTeamsContextConfig): Provider[] {
  const internal = signal<TeamsContext | null>(config.fallback ?? null);
  return [
    { provide: TEAMS_CONTEXT, useFactory: () => internal.asReadonly() },
    {
      provide: ENVIRONMENT_INITIALIZER,
      multi: true,
      useFactory: () => {
        const injector = inject(Injector);
        return (): void => {
          runInInjectionContext(injector, () => {
            void hydrateTeamsContext(config, internal);
          });
        };
      },
    },
  ];
}

async function hydrateTeamsContext(
  config: ProvideTeamsContextConfig,
  target: ReturnType<typeof signal<TeamsContext | null>>,
): Promise<void> {
  try {
    const ctx = await config.loadContext();
    if (ctx) target.set(ctx);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[provideTeamsContext] loadContext failed:', err);
    if (config.fallback) target.set(config.fallback);
  }
}
