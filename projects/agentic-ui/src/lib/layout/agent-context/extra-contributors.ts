import { inject, Injectable, InjectionToken, type Signal, signal } from '@angular/core';
import {
  DashboardTemplateRegistry,
  LayoutTemplateRegistry,
} from '../templates';
import { LayoutResolver } from '../resolver';
import { SelectionStore } from '../selection';
import type { ContextContributor, ContextFragment } from './types';

// ── SelectionContextContributor (ADR-047 D3) ──────────────────────────────

/**
 * Emits `<selection kind="..." count="N">` describing what the user
 * is currently looking at. The agent uses this to context-switch on
 * click — clicking a single document AND asking *"what's the
 * privilege status?"* tells the agent exactly which document the
 * question is about, no further clarification needed.
 *
 * Returns null when no selection is active (so the agent infers
 * "user has no focused selection" by absence).
 */
@Injectable({ providedIn: 'root' })
export class SelectionContextContributor implements ContextContributor {
  readonly id = 'selection';
  readonly order = 250;

  private readonly selectionStore = inject(SelectionStore);

  contribute(): ContextFragment | null {
    const state = this.selectionStore.selection();
    if (!state) return null;
    const idList = state.ids.slice(0, 10);
    return {
      tag: 'selection',
      attrs: { kind: state.kind, count: state.ids.length },
      content: idList.map((id) => ({ tag: 'id', content: id })),
    };
  }
}

// ── AvailableTemplatesContextContributor (ADR-047 D3) ─────────────────────

/**
 * Emits `<available-templates>` listing every approved layout +
 * dashboard template. Lets the agent recommend by name — *"I see
 * a `privilege-review-v3` layout template tagged for this use case,
 * shall I apply it?"* — without the user having to know what's in
 * the catalog.
 *
 * Only approved templates surface (same gate the user-facing picker
 * uses); the agent doesn't see drafts or rejected entries.
 */
@Injectable({ providedIn: 'root' })
export class AvailableTemplatesContextContributor implements ContextContributor {
  readonly id = 'available-templates';
  readonly order = 400;

  private readonly layoutTemplates = inject(LayoutTemplateRegistry);
  private readonly dashboardTemplates = inject(DashboardTemplateRegistry);

  contribute(): ContextFragment | null {
    const layout = this.layoutTemplates.approved();
    const dashboard = this.dashboardTemplates.approved();
    if (layout.length === 0 && dashboard.length === 0) return null;
    const fragments: ContextFragment[] = [];
    for (const t of layout) {
      fragments.push({
        tag: 'template',
        attrs: {
          kind: 'layout',
          name: t.name,
          version: t.version ?? 'v1',
          tags: t.tags.join(','),
        },
        content: t.description,
      });
    }
    for (const t of dashboard) {
      fragments.push({
        tag: 'template',
        attrs: {
          kind: 'dashboard',
          name: t.name,
          version: t.version ?? 'v1',
          tags: t.tags.join(','),
        },
        content: t.description,
      });
    }
    return { tag: 'available-templates', content: fragments };
  }
}

// ── OverrideStackContextContributor (ADR-047 D3) ──────────────────────────

/**
 * Emits `<override-stack>` describing which precedence layer is
 * driving each slot of the current resolved layout. Re-uses
 * `LayoutResolver.active().appliedRules` so the agent sees:
 *
 *   <override-stack>
 *     <slot name="primary"  source="agent" reason="..." />
 *     <slot name="sidebar"  source="route" reason="..." />
 *     <slot name="footer"   source="persona" reason="..." />
 *   </override-stack>
 *
 * Conceptually parallel to `LayoutStateContextContributor` from PR1
 * but framed as "stack" — emphasising the precedence layering rather
 * than just "current state". Agents can reason: *"don't re-emit the
 * agent layer for `sidebar` — it would override a route default
 * that's fine"*.
 *
 * Returns null when no rules fire (resolver output is empty).
 */
@Injectable({ providedIn: 'root' })
export class OverrideStackContextContributor implements ContextContributor {
  readonly id = 'override-stack';
  readonly order = 350;

  private readonly resolver = inject(LayoutResolver);

  contribute(): ContextFragment | null {
    const { appliedRules } = this.resolver.active();
    if (appliedRules.length === 0) return null;
    return {
      tag: 'override-stack',
      content: appliedRules.map((rule) => ({
        tag: 'slot',
        attrs: {
          name: rule.slotName,
          source: rule.source,
          weight: rule.weight,
          reason: rule.reason,
        },
      })),
    };
  }
}

// ── RecentToolCallsContextContributor (ADR-047 D3) ────────────────────────

/**
 * Adopter-bound signal holding the recent tool-call history. The lib
 * doesn't track tool calls centrally (today they're chained via
 * audit hooks); adopters wire a signal source — typically computed
 * over their tool-result-cache or audit log.
 *
 * Shape: array of `{ timestamp, tool, args?, outcome? }`, newest-last.
 * Contributor takes the most-recent N (default 10).
 */
export interface RecentToolCall {
  readonly timestamp: string;
  readonly tool: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly outcome?: 'ok' | 'error' | 'pending';
}

export const RECENT_TOOL_CALLS_SIGNAL = new InjectionToken<Signal<readonly RecentToolCall[]>>(
  'RECENT_TOOL_CALLS_SIGNAL',
  { factory: () => signal<readonly RecentToolCall[]>([]).asReadonly() },
);

@Injectable({ providedIn: 'root' })
export class RecentToolCallsContextContributor implements ContextContributor {
  readonly id = 'recent-tool-calls';
  readonly order = 500;

  private readonly recentSignal = inject(RECENT_TOOL_CALLS_SIGNAL);

  contribute(): ContextFragment | null {
    const recent = this.recentSignal();
    if (recent.length === 0) return null;
    const last10 = recent.slice(-10);
    return {
      tag: 'recent-tool-calls',
      content: last10.map((call) => ({
        tag: 'call',
        attrs: {
          timestamp: call.timestamp,
          tool: call.tool,
          ...(call.outcome ? { outcome: call.outcome } : {}),
        },
      })),
    };
  }
}

// ── MatterContextContributor (ADR-047 D3) ─────────────────────────────────

/**
 * Adopter-bound signal carrying matter identity + phase. Used by the
 * eDiscovery flagship; other domains (customer support, financial
 * dashboards) wire their analog ("ticket", "portfolio").
 *
 * Shape: `{ id, phase?, attributes? }`. Contributor renders as
 * `<matter id="..." phase="..."><attribute key="..."> ... </></>`.
 */
export interface MatterContext {
  readonly id: string;
  readonly phase?: string;
  readonly attributes?: Readonly<Record<string, string>>;
}

export const MATTER_CONTEXT_SIGNAL = new InjectionToken<Signal<MatterContext | null>>(
  'MATTER_CONTEXT_SIGNAL',
  { factory: () => signal<MatterContext | null>(null).asReadonly() },
);

@Injectable({ providedIn: 'root' })
export class MatterContextContributor implements ContextContributor {
  readonly id = 'matter';
  readonly order = 150;

  private readonly matterSignal = inject(MATTER_CONTEXT_SIGNAL);

  contribute(): ContextFragment | null {
    const matter = this.matterSignal();
    if (!matter) return null;
    const attrs: Record<string, string> = { id: matter.id };
    if (matter.phase) attrs['phase'] = matter.phase;
    const attrFragments: ContextFragment[] = [];
    for (const [k, v] of Object.entries(matter.attributes ?? {})) {
      attrFragments.push({ tag: 'attr', attrs: { key: k }, content: v });
    }
    return {
      tag: 'matter',
      attrs,
      content: attrFragments.length > 0 ? attrFragments : undefined,
    };
  }
}
