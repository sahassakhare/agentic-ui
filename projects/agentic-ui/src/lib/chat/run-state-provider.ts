import { InjectionToken } from '@angular/core';

/**
 * Function returning the **reasoning context** the agent should see on
 * each run. Threaded into `AgenticRunInput.state` (Capability M1 R4 —
 * see ADR-013).
 *
 * The provider is called once per `runUntilSettled` invocation. Return
 * a fresh object — callers may not freeze or mutate it. Common shape:
 *
 * ```ts
 * () => ({
 *   persona: personaService.active(),
 *   matter: { id: matterStore.id, type: matterStore.type },
 *   activeRoute: router.url,
 * })
 * ```
 *
 * Default factory returns `{}` — this preserves v1.2 behaviour
 * (no state on the wire) until a host opts in.
 *
 * **Not a security boundary.** State communicates context to the
 * agent for reasoning. The trust gate is `setScopePolicy`
 * (ADR-008) which filters `tools[]` before the request leaves the
 * browser. State changes don't gate access — they just let the
 * agent phrase responses appropriately ("As a paralegal, you
 * can't release; the request will be queued for Lead Counsel").
 */
export type AgenticRunStateProvider = () => Readonly<Record<string, unknown>>;

/**
 * Injection token used by `injectAgenticChat()` to populate
 * `AgenticRunInput.state` on every run. Hosts override this to thread
 * persona, matter, active route, or anything else the LLM should be
 * aware of on each turn.
 *
 * @example
 * ```ts
 * // app.config.ts
 * { provide: AGENTIC_RUN_STATE_PROVIDER, useFactory: () => {
 *     const persona = inject(PersonaService);
 *     const matter  = inject(MatterStore);
 *     const router  = inject(Router);
 *     return () => ({
 *       persona: persona.active(),
 *       matter:  { id: matter.matterId, type: matter.matterType },
 *       activeRoute: router.url,
 *     });
 * }}
 * ```
 *
 * Default returns `{}` — equivalent to v1.2 behaviour.
 */
export const AGENTIC_RUN_STATE_PROVIDER = new InjectionToken<AgenticRunStateProvider>(
  'AGENTIC_RUN_STATE_PROVIDER',
  { providedIn: 'root', factory: () => () => ({}) },
);
