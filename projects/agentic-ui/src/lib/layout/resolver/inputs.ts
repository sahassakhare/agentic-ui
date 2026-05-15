import {
  inject,
  Injectable,
  InjectionToken,
  type Signal,
  signal,
} from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { filter, map } from 'rxjs/operators';
import { toSignal } from '@angular/core/rxjs-interop';
import type { SlotMap } from '../types';
import type { LayoutInput, LayoutInputSource, LayoutRule } from './types';

// ── Route input ───────────────────────────────────────────────────────────

/**
 * Adopter-supplied rule for `RouteLayoutInput`. A rule fires when the
 * current router URL matches `pattern`. Pattern shapes:
 *
 *  - exact string — `/documents` matches only that URL
 *  - trailing wildcard — `/documents/*` matches `/documents` + any sub-path
 *  - `RegExp` — full flexibility for params / query / fragments
 */
export interface RouteLayoutRule {
  readonly pattern: string | RegExp;
  readonly slots: Partial<SlotMap>;
  readonly evictSlots?: readonly string[];
  readonly priority?: number;
  readonly reason?: string;
}

export const ROUTE_LAYOUT_RULES = new InjectionToken<readonly RouteLayoutRule[]>(
  'ROUTE_LAYOUT_RULES',
  { factory: () => [] },
);

@Injectable({ providedIn: 'root' })
export class RouteLayoutInput implements LayoutInput {
  readonly id = 'route';
  readonly source: LayoutInputSource = 'route';

  private readonly router = inject(Router, { optional: true });
  private readonly rules = inject(ROUTE_LAYOUT_RULES);

  // Tracks the current URL as a signal. In test / SSR environments
  // without Router, this is just a static empty string so `evaluate()`
  // returns no rules.
  private readonly currentUrl: Signal<string> = this.router
    ? toSignal(
        this.router.events.pipe(
          filter((e): e is NavigationEnd => e instanceof NavigationEnd),
          map(() => this.router!.url),
        ),
        { initialValue: this.router.url },
      )
    : signal('');

  evaluate(): readonly LayoutRule[] {
    const url = this.currentUrl();
    if (!url) return [];
    return this.rules
      .filter((rule) => matchesPattern(url, rule.pattern))
      .map((rule, index) => ({
        id: `route:${String(rule.pattern)}#${index}`,
        source: this.source,
        slots: rule.slots,
        evictSlots: rule.evictSlots,
        priority: rule.priority,
        reason: rule.reason ?? `route ${url} matched pattern ${String(rule.pattern)}`,
      }));
  }
}

function matchesPattern(url: string, pattern: string | RegExp): boolean {
  if (pattern instanceof RegExp) return pattern.test(url);
  if (pattern.endsWith('/*')) {
    const prefix = pattern.slice(0, -2);
    return url === prefix || url.startsWith(prefix + '/');
  }
  return url === pattern;
}

// ── Persona input ─────────────────────────────────────────────────────────

/**
 * Adopter-supplied rule for `PersonaLayoutInput`. Active when the host's
 * persona signal (registered via `ACTIVE_PERSONA_SIGNAL`) reads `personaId`.
 */
export interface PersonaLayoutRule {
  readonly personaId: string;
  readonly slots: Partial<SlotMap>;
  readonly evictSlots?: readonly string[];
  readonly priority?: number;
  readonly reason?: string;
}

export const PERSONA_LAYOUT_RULES = new InjectionToken<readonly PersonaLayoutRule[]>(
  'PERSONA_LAYOUT_RULES',
  { factory: () => [] },
);

/**
 * Adopters bind their persona-tracking signal here. The lib stays
 * persona-impl agnostic — eDiscovery wires `PersonaService.active`,
 * other apps wire whatever signal they hold the active id in.
 */
export const ACTIVE_PERSONA_SIGNAL = new InjectionToken<Signal<string | null>>(
  'ACTIVE_PERSONA_SIGNAL',
  { factory: () => signal(null) },
);

@Injectable({ providedIn: 'root' })
export class PersonaLayoutInput implements LayoutInput {
  readonly id = 'persona';
  readonly source: LayoutInputSource = 'persona';

  private readonly rules = inject(PERSONA_LAYOUT_RULES);
  private readonly personaSignal = inject(ACTIVE_PERSONA_SIGNAL);

  evaluate(): readonly LayoutRule[] {
    const personaId = this.personaSignal();
    if (!personaId) return [];
    return this.rules
      .filter((rule) => rule.personaId === personaId)
      .map((rule, index) => ({
        id: `persona:${personaId}#${index}`,
        source: this.source,
        slots: rule.slots,
        evictSlots: rule.evictSlots,
        priority: rule.priority,
        reason: rule.reason ?? `persona ${personaId} default`,
      }));
  }
}

// ── Agent override input ──────────────────────────────────────────────────

/**
 * Adopters bind the agent-override signal here. Typically wired from
 * an existing `WorkspaceLayoutStore.slots` signal that the
 * `setWorkspaceLayout` tool writes to. The lib stays storage-impl
 * agnostic — only the signal contract is fixed.
 */
export const AGENT_LAYOUT_SIGNAL = new InjectionToken<Signal<SlotMap | null>>(
  'AGENT_LAYOUT_SIGNAL',
  { factory: () => signal(null) },
);

@Injectable({ providedIn: 'root' })
export class AgentLayoutInput implements LayoutInput {
  readonly id = 'agent';
  readonly source: LayoutInputSource = 'agent';

  private readonly slotsSignal = inject(AGENT_LAYOUT_SIGNAL);

  evaluate(): readonly LayoutRule[] {
    const slots = this.slotsSignal();
    if (!slots || Object.keys(slots).length === 0) return [];
    return [
      {
        id: 'agent:active',
        source: this.source,
        slots,
        reason: 'agent emitted layout via setWorkspaceLayout',
      },
    ];
  }
}
