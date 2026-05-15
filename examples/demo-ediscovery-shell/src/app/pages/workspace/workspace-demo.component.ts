import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  LayeredLayoutStore,
  LayoutAuditTracker,
  LayoutResolver,
  WorkspaceLayoutComponent,
  type SlotMap,
  type ResponsiveCollapseRule,
} from '@infra-tools/agentic-ui';
import { PersonaService } from '../../services/persona.service';
import { WorkspaceLayoutStore } from '../../services/workspace-layout.store';

/**
 * `/workspace` — demo of the lib's slot-based `<mvk-workspace-layout>`
 * (post-chat-surfaces P0 / ADR-043 D1 + D6).
 *
 * The shell's hand-rolled three-pane chassis (sidebar / main / chat
 * rail) is what every other route uses — it predates the lib's
 * slot-based primitive. This route mounts the lib's
 * `<mvk-workspace-layout>` with an explicit `SlotMap` that the LLM
 * could emit at runtime via a `LAYOUT_RENDER` event. Three slots:
 *
 * - `primary` (60%) — a kpiTile with a workflow-overview markdown
 * - `sidebar` (25%) — a kpiTile with persona-aware "what's next" text
 * - `footer`  (15%, collapses below 1024px) — chain-of-custody banner
 *
 * Persona-driven density: the same `provideLayoutPolicy` that
 * supplies the chat-shell mode also exposes a `density()` signal.
 * Lead-counsel personas get compact slot sizes; paralegal personas
 * get comfortable.
 *
 * Production would point each slot at a richer widget (document
 * preview, redaction editor, tag panel, etc.) — the lib resolves
 * each `component: 'name'` via `ComponentRegistry`, so any
 * registered widget can fill a slot.
 */
@Component({
  selector: 'app-workspace-demo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WorkspaceLayoutComponent],
  template: `
    <section class="page-head">
      <div>
        <p class="crumb">Workspace</p>
        <h1>Slot-based workspace layout</h1>
        <p class="muted">
          The lib's <code>&lt;mvk-workspace-layout&gt;</code> renders a slot map. Each slot's
          <code>component</code> is a <code>ComponentRegistry</code> name — the LLM emits these
          via a <code>LAYOUT_RENDER</code> event; the host can also pass them statically.
          Persona switches re-derive the slot sizes from <code>LAYOUT_POLICY.density()</code>.
        </p>
      </div>
    </section>

    <!-- ADR-047 D6 — change attribution banner. Always renders when
         there's something in the audit chain to attribute to;
         the agent-driven dot turns blue when the agent layer is
         currently active. -->
    @if (attribution(); as attr) {
      <div class="agent-banner" role="status" [class.agent]="agentDriven()">
        <span class="dot" aria-hidden="true">●</span>
        <div class="meta">
          <strong>{{ attr.headline }}</strong>
          <span class="dim">{{ attr.detail }}</span>
        </div>
        <!-- ADR-047 D4 — Save current resolved layout to the user
             tier as the active persona's saved preference. -->
        <button type="button" class="btn" [disabled]="savedTick() > 0" (click)="savePreference()">
          {{ savedTick() > 0 ? '✓ Saved' : '📌 Save as my preference' }}
        </button>
        <!-- ADR-047 D5 — Reset hierarchy. Single button toggles a
             menu of "Reset to my saved / matter / org / lib default". -->
        <div class="reset-group">
          <button type="button" class="btn"
                  [class.open]="resetMenuOpen()"
                  (click)="toggleResetMenu()"
                  aria-haspopup="menu"
                  [attr.aria-expanded]="resetMenuOpen()">
            Reset ▾
          </button>
          @if (resetMenuOpen()) {
            <ul class="reset-menu" role="menu">
              <li role="menuitem"><button type="button" (click)="resetTo('agent')">Reset to my saved</button></li>
              <li role="menuitem"><button type="button" (click)="resetTo('user-saved')">Reset to matter default</button></li>
              <li role="menuitem"><button type="button" (click)="resetTo('matter-default')">Reset to org default</button></li>
              <li role="menuitem"><button type="button" (click)="resetTo('all')">Reset to lib default</button></li>
            </ul>
          }
        </div>
      </div>
    }

    <div class="canvas" [attr.data-density]="density()">
      <mvk-workspace-layout
        [slots]="slots()"
        [responsive]="responsive"
        layoutName="ediscovery-three-pane" />
    </div>

    @if (appliedRules().length > 0) {
      <details class="resolver-breakdown">
        <summary>Layout resolved from {{ appliedRules().length }} rule(s)</summary>
        <ul>
          @for (rule of appliedRules(); track rule.ruleId) {
            <li>
              <strong>{{ rule.slotName }}</strong>
              <span class="rule-source">{{ rule.source }}</span>
              <span class="rule-weight">w={{ rule.weight }}</span>
              <span class="rule-reason">— {{ rule.reason }}</span>
            </li>
          }
        </ul>
      </details>
    }

    <p class="footnote">
      <em>Default slots are bound to the <code>kpiTile</code> widget for all three slots. Production would substitute
      <code>documentPreview</code>, <code>tagPanel</code>, <code>redactionEditor</code>, etc. from the federated remotes.
      Ask the chat assistant: <em>"open document preview + tag panel + privilege log in a workspace"</em> and the agent's
      <code>setWorkspaceLayout</code> tool reshapes this canvas live — the slot map is persisted per persona.</em>
    </p>
  `,
  styles: `
    :host { display: block; max-width: 1200px; }
    .page-head { margin-bottom: var(--s-5); }
    .page-head h1 { margin: 0.2rem 0 0; font-size: var(--fs-2xl); letter-spacing: -0.01em; }
    .crumb { margin: 0; font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-text-faint); }
    .muted { margin: 0.4rem 0 0; color: var(--c-text-2); font-size: var(--fs-sm); max-width: 760px; }
    code { font-family: ui-monospace, monospace; font-size: 0.92em; background: var(--c-surface-1); padding: 1px 5px; border-radius: var(--r-sm); }
    .canvas {
      min-height: 360px;
      border: 1px solid var(--c-border);
      border-radius: var(--r-md);
      padding: var(--s-3);
      background: var(--c-surface);
    }
    .canvas[data-density="compact"]      { padding: var(--s-2); }
    .canvas[data-density="dense"]        { padding: var(--s-1); }
    .footnote { margin-top: var(--s-4); font-size: var(--fs-xs); color: var(--c-text-2); }
    .footnote code { font-size: 0.82em; }
    .agent-banner {
      display: flex; align-items: center; gap: var(--s-3);
      padding: var(--s-3) var(--s-4); margin-bottom: var(--s-3);
      background: var(--c-info-soft, #dbeafe);
      border: 1px solid var(--c-info, #0284c7);
      border-left-width: 4px; border-radius: var(--r-md);
      font-size: var(--fs-sm);
    }
    .agent-banner .dot { color: var(--c-info, #0284c7); font-size: 0.9rem; }
    .agent-banner strong { color: var(--c-text-1); }
    .agent-banner .dim { color: var(--c-text-2); }
    .agent-banner .reset {
      margin-left: auto; padding: 0.35rem 0.8rem;
      background: var(--c-surface); border: 1px solid var(--c-border);
      border-radius: var(--r-md); font-size: var(--fs-xs); cursor: pointer;
    }
    .agent-banner .reset:hover { background: var(--c-surface-1); }
    .agent-banner .meta { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0; }
    .agent-banner.agent { background: var(--c-info-soft, #dbeafe); }
    .agent-banner.agent .dot { color: var(--c-info, #0284c7); }
    .agent-banner:not(.agent) {
      background: var(--c-surface);
      border-color: var(--c-border);
      border-left-color: var(--c-success, #059669);
    }
    .agent-banner:not(.agent) .dot { color: var(--c-success, #059669); }
    .agent-banner .btn {
      padding: 0.35rem 0.8rem; background: var(--c-surface); border: 1px solid var(--c-border);
      border-radius: var(--r-md); font-size: var(--fs-xs); cursor: pointer; color: var(--c-text-1);
      white-space: nowrap;
    }
    .agent-banner .btn:hover:not(:disabled) { background: var(--c-surface-1); border-color: var(--c-accent, #6366f1); }
    .agent-banner .btn:disabled { color: var(--c-success, #059669); border-color: var(--c-success, #059669); background: var(--c-surface); cursor: default; }
    .agent-banner .btn.open { background: var(--c-surface-1); border-color: var(--c-accent, #6366f1); }
    .agent-banner .reset-group { position: relative; display: inline-block; }
    .reset-menu {
      position: absolute; right: 0; top: calc(100% + 4px);
      list-style: none; margin: 0; padding: 4px; min-width: 200px;
      background: var(--c-surface); border: 1px solid var(--c-border);
      border-radius: var(--r-md); box-shadow: 0 4px 12px rgba(0,0,0,0.08);
      z-index: 10;
    }
    .reset-menu li { margin: 0; }
    .reset-menu button {
      display: block; width: 100%; padding: 0.45rem 0.7rem; text-align: left;
      background: transparent; border: 0; cursor: pointer; font-size: var(--fs-xs);
      color: var(--c-text-1); border-radius: var(--r-sm);
    }
    .reset-menu button:hover { background: var(--c-surface-1); }
    .resolver-breakdown {
      margin-top: var(--s-3); font-size: var(--fs-xs); color: var(--c-text-2);
      padding: var(--s-2) var(--s-3); border: 1px dashed var(--c-border); border-radius: var(--r-md);
    }
    .resolver-breakdown summary { cursor: pointer; user-select: none; }
    .resolver-breakdown ul { margin: var(--s-2) 0 0; padding-left: var(--s-4); }
    .resolver-breakdown li { margin: 0.15rem 0; }
    .resolver-breakdown .rule-source {
      display: inline-block; margin-left: var(--s-2);
      padding: 0 var(--s-2); border-radius: var(--r-sm);
      background: var(--c-surface-1); font-family: ui-monospace, monospace; font-size: 0.85em;
    }
    .resolver-breakdown .rule-weight { margin-left: var(--s-2); color: var(--c-text-faint); font-family: ui-monospace, monospace; font-size: 0.85em; }
    .resolver-breakdown .rule-reason { margin-left: var(--s-2); }
  `,
})
export class WorkspaceDemoPage {
  private readonly persona = inject(PersonaService);
  private readonly store = inject(WorkspaceLayoutStore);
  private readonly resolver = inject(LayoutResolver);
  private readonly layered = inject(LayeredLayoutStore);
  private readonly audit = inject(LayoutAuditTracker);

  /** True when the agent emitted a SlotMap via setWorkspaceLayout. */
  protected readonly agentDriven = computed(() => this.store.slots() !== null);

  /**
   * ADR-047 D5 — reset hierarchy menu open/closed state.
   */
  protected readonly resetMenuOpen = signal(false);

  /**
   * ADR-047 D4 — flash "✓ Saved" for ~2s after the user clicks Save.
   * Goes via a tick counter that increments on save + decrements
   * on a setTimeout; the button reads `savedTick() > 0` to render.
   */
  protected readonly savedTick = signal(0);

  /**
   * ADR-047 D6 — attribution shown on the banner. Picks the latest
   * audit event with attribution + extracts source/user/age into a
   * human sentence. Returns null when the chain is empty.
   */
  protected readonly attribution = computed(() => {
    const chain = this.audit.chain();
    if (chain.length === 0) return null;
    const latest = chain[chain.length - 1];
    const source = latest.appliedRules[0]?.source ?? 'unknown';
    const user = latest.attribution?.['userId'] ?? 'system';
    const ago = ageString(latest.timestamp);
    const headlinePrefix = this.agentDriven() ? 'Agent-driven layout active.' : 'Layout active.';
    const detailParts = [
      `last set by ${user}`,
      `${ago}`,
      `via ${source} layer`,
    ];
    return {
      headline: headlinePrefix,
      detail: detailParts.join(' · '),
    };
  });

  /**
   * ADR-046 PR1 — when the resolved layout includes slots from non-route
   * inputs, surface a sub-banner showing the precedence breakdown. Lets
   * end users see exactly which layer is driving each slot ("primary
   * from route, footer from persona pin").
   */
  protected readonly appliedRules = computed(() => this.resolver.active().appliedRules);

  /** Drop the agent-emitted slots → fall back to the per-persona default. */
  protected resetLayout(): void {
    this.store.clear();
  }

  /**
   * ADR-047 D5 — toggle the reset-hierarchy menu open/closed.
   */
  protected toggleResetMenu(): void {
    this.resetMenuOpen.update((v) => !v);
  }

  /**
   * ADR-047 D5 — reset hierarchy. Each level clears the agent layer
   * plus higher-precedence tiers, leaving the named tier (and below)
   * intact. Argument matches the precedence target the user wants to
   * fall back to.
   */
  protected resetTo(level: 'agent' | 'user-saved' | 'matter-default' | 'all'): void {
    // Always clear the agent layer — it's volatile by definition.
    this.store.clear();
    const personaId = this.persona.active();
    const key = `workspace:${personaId}`;
    void (async () => {
      if (level === 'user-saved' || level === 'matter-default' || level === 'all') {
        try { await this.layered.removeFromTier('user-saved', key); } catch { /* ignore tier missing */ }
      }
      if (level === 'matter-default' || level === 'all') {
        try { await this.layered.removeFromTier('matter-default', key); } catch { /* ignore */ }
      }
      if (level === 'all') {
        try { await this.layered.removeFromTier('persona-default', key); } catch { /* ignore */ }
        try { await this.layered.removeFromTier('org-default', key); } catch { /* ignore */ }
      }
    })();
    this.resetMenuOpen.set(false);
  }

  /**
   * ADR-047 D4 — snapshot the currently resolved SlotMap into the
   * user-saved tier under a per-persona key. Subsequent boots
   * rehydrate this through `LayeredLayoutStore` (when adopters wire
   * a `UserSavedLayoutInput`).
   */
  protected savePreference(): void {
    const slots = this.resolver.active().slots;
    if (Object.keys(slots).length === 0) return;
    const personaId = this.persona.active();
    const key = `workspace:${personaId}`;
    void this.layered.writeToTier('user-saved', key, {
      schemaVersion: 1,
      slots,
    }).then(() => {
      this.savedTick.update((v) => v + 1);
      setTimeout(() => this.savedTick.update((v) => Math.max(0, v - 1)), 2000);
    }).catch((err) => {
      console.error('[workspace] savePreference failed', err);
    });
  }

  /** Persona-aware density signal — drives the slot padding. */
  protected readonly density = computed(() => {
    switch (this.persona.active()) {
      case 'lead-counsel': return 'compact';
      case 'vendor-reviewer': return 'dense';
      default: return 'comfortable';
    }
  });

  /**
   * Slot map read directly from `LayoutResolver.active()` — the engine
   * merges route + persona + agent inputs by precedence weight and
   * produces the resolved SlotMap. ADR-046 PR1 shift: the component
   * no longer builds its own fallback; route rules (registered in
   * app.config) provide the baseline, and the agent's
   * `setWorkspaceLayout` override layers on top.
   *
   * When the resolver produces nothing (no rules fire for the current
   * route + persona + agent state), the fallback is the lib's empty
   * SlotMap — the workspace canvas simply renders no slots, which is
   * the correct "no layout configured" state.
   */
  protected readonly slots = computed<SlotMap>(() => this.resolver.active().slots);

  /**
   * Responsive collapse rule — the footer slot disappears (or
   * becomes a slide-in drawer) on screens below 1024px. The lib's
   * ResizeObserver consults this on every host-width change.
   */
  protected readonly responsive: readonly ResponsiveCollapseRule[] = [
    { belowPx: 1024, collapse: [], drawer: ['footer'] },
    { belowPx: 768,  collapse: ['footer'], drawer: ['sidebar'] },
  ];
}

/**
 * ADR-047 D6 — human-readable age string for the attribution banner.
 * "just now" / "5 min ago" / "2 hours ago" / "3 days ago" / "older
 * than a month".
 */
function ageString(timestamp: string): string {
  const then = Date.parse(timestamp);
  if (Number.isNaN(then)) return 'recently';
  const diffMs = Date.now() - then;
  if (diffMs < 60_000) return 'just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return 'older than a month';
}
