import {
  inject,
  Injectable,
  type Signal,
  signal,
} from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs/operators';
import { LayoutResolver } from '../resolver';
import { ACTIVE_PERSONA_SIGNAL } from '../resolver/inputs';
import type { ContextContributor, ContextFragment } from './types';

// ── Route contributor ─────────────────────────────────────────────────────

/**
 * Emits `<route>/current/url</route>`. Lets the agent know what route
 * the user is currently looking at without the user having to mention
 * it. Single most signal-dense contributor — adopters should always
 * include it.
 */
@Injectable({ providedIn: 'root' })
export class RouteContextContributor implements ContextContributor {
  readonly id = 'route';
  readonly order = 100;

  private readonly router = inject(Router, { optional: true });
  private readonly currentUrl: Signal<string> = this.router
    ? toSignal(
        this.router.events.pipe(
          filter((e): e is NavigationEnd => e instanceof NavigationEnd),
          map(() => this.router!.url),
        ),
        { initialValue: this.router.url },
      )
    : signal('');

  contribute(): ContextFragment | null {
    const url = this.currentUrl();
    if (!url) return null;
    return { tag: 'route', content: url };
  }
}

// ── Persona contributor ───────────────────────────────────────────────────

/**
 * Emits `<persona>lead-counsel</persona>`. Lets the agent reason about
 * who's asking — different personas warrant different responses (a
 * paralegal asking about privilege wants a checklist; a partner wants
 * a summary).
 */
@Injectable({ providedIn: 'root' })
export class PersonaContextContributor implements ContextContributor {
  readonly id = 'persona';
  readonly order = 200;

  private readonly personaSignal = inject(ACTIVE_PERSONA_SIGNAL);

  contribute(): ContextFragment | null {
    const personaId = this.personaSignal();
    if (!personaId) return null;
    return { tag: 'persona', content: personaId };
  }
}

// ── Layout-state contributor ──────────────────────────────────────────────

/**
 * Emits the live `<current-layout>` block. The agent sees which inputs
 * are currently driving the resolved layout — without this, it has no
 * way to know whether a re-emit is necessary (the `fb61f14` "always
 * re-call" instruction becomes a fallback rather than the only safety
 * net once this contributor lands).
 *
 * Shape:
 * ```xml
 * <current-layout>
 *   <slot name="primary" source="route" reason="route /documents matched ..." />
 *   <slot name="sidebar" source="persona" reason="persona lead-counsel default" />
 * </current-layout>
 * ```
 *
 * When the resolved layout is empty (no rules currently fire), the
 * contributor returns `null` rather than emitting an empty block —
 * lets the agent infer "no active layout" by absence.
 */
@Injectable({ providedIn: 'root' })
export class LayoutStateContextContributor implements ContextContributor {
  readonly id = 'layout-state';
  readonly order = 300;

  private readonly resolver = inject(LayoutResolver);

  contribute(): ContextFragment | null {
    const { appliedRules } = this.resolver.active();
    if (appliedRules.length === 0) return null;
    return {
      tag: 'current-layout',
      content: appliedRules.map((rule) => ({
        tag: 'slot',
        attrs: {
          name: rule.slotName,
          source: rule.source,
          reason: rule.reason,
        },
      })),
    };
  }
}
