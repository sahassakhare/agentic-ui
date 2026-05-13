import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import {
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

    @if (agentDriven()) {
      <div class="agent-banner" role="status">
        <span class="dot" aria-hidden="true">●</span>
        <div>
          <strong>Agent-driven layout active.</strong>
          <span class="dim"> Slots emitted by the LLM via the <code>setWorkspaceLayout</code> tool. Click "Reset" to drop back to the per-persona default.</span>
        </div>
        <button type="button" class="reset" (click)="resetLayout()">Reset</button>
      </div>
    }

    <div class="canvas" [attr.data-density]="density()">
      <mvk-workspace-layout
        [slots]="slots()"
        [responsive]="responsive"
        layoutName="ediscovery-three-pane" />
    </div>

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
  `,
})
export class WorkspaceDemoPage {
  private readonly persona = inject(PersonaService);
  private readonly store = inject(WorkspaceLayoutStore);

  /** True when the agent emitted a SlotMap via setWorkspaceLayout. */
  protected readonly agentDriven = computed(() => this.store.slots() !== null);

  /** Drop the agent-emitted slots → fall back to the per-persona default. */
  protected resetLayout(): void {
    this.store.clear();
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
   * Per-density slot sizes — wider primary for compact (more
   * data-dense viewers want the workspace pane to dominate);
   * smaller primary for comfortable (more breathing room around
   * the sidebar + footer).
   */
  protected readonly slots = computed<SlotMap>(() => {
    // Agent-emitted slot map takes precedence — the setWorkspaceLayout
    // tool writes here when the LLM picks it, and the canvas re-renders
    // live without a navigation. Fall through to the per-persona
    // default below if no agent slots are pending.
    const agent = this.store.slots();
    if (agent) return agent;

    const dense = this.density() !== 'comfortable';
    return {
      primary: {
        component: 'kpiTile',
        size: { default: dense ? '65%' : '60%', min: '320px' },
        props: {
          value: {
            markdown:
              'Workspace — primary slot. Production would mount the documentPreview widget ' +
              'here (with PDF + agent annotations layered). Persona-density signal: ' +
              this.density() + '.',
          },
        },
      },
      sidebar: {
        component: 'kpiTile',
        size: { default: dense ? '20%' : '25%', min: '220px' },
        props: {
          value: {
            markdown:
              'Sidebar slot. Best-fit for a tagPanel / privilegeLog companion. The agent ' +
              'can re-emit a different component here on the next LAYOUT_RENDER turn.',
          },
        },
      },
      footer: {
        component: 'kpiTile',
        size: { default: '15%', min: '160px' },
        props: {
          value: {
            markdown:
              'Footer slot — chain-of-custody summary. Collapses to a drawer on screens < 1024px ' +
              '(see the responsive rule).',
          },
        },
      },
    };
  });

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
