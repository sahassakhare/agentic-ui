import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { ChatShellComponent, ToolRegistry, CapabilityRegistry } from '@infra-tools/agentic-ui';
import { IconComponent } from '../ui/icon.component';
import { PersonaService } from '../services/persona.service';
import { ChatBridgeService } from '../services/chat-bridge.service';

/**
 * Curated prompt catalog surfaced in the right-rail "Try asking" panel.
 * Single source of truth: a tweaked subset of the prompts in
 * `docs/cookbook/sample-prompts.md`'s eDiscovery section, grouped so the
 * 360-px rail stays readable. Each entry can carry a capability tag
 * (F1–F6) which renders as a small badge so the viewer can see at a
 * glance which dynamic-UI capability the prompt exercises.
 *
 * `requiresAttachment` flags prompts that need a file attached before
 * sending (F6 multi-modal). Click is disabled in that case and a
 * tooltip explains the precondition.
 */
type Capability = 'F1' | 'F1-dyn' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6';

/** Visible label for each capability badge (CSS class follows the id directly). */
const CAPABILITY_LABEL: Record<Capability, string> = {
  'F1':     'F1',
  'F1-dyn': 'F1*',
  'F2':     'F2',
  'F3':     'F3',
  'F4':     'F4',
  'F5':     'F5',
  'F6':     'F6',
};

/** Tooltip explaining the capability the prompt exercises. */
const CAPABILITY_TITLE: Record<Capability, string> = {
  'F1':     'F1 — composable form (predefined catalog + predicate-gated sections)',
  'F1-dyn': 'F1* — agent-generated form (LLM emits the entire schema; widget renders + validates)',
  'F2':     'F2 — live data (DataSource adapter feeds widget state)',
  'F3':     'F3 — guided workflow (multi-step wizard with conditional jumps)',
  'F4':     'F4 — HITL approval (tool intercept; persona-gated sign-off)',
  'F5':     'F5 — long-running operation (progress streaming via OperationRegistry)',
  'F6':     'F6 — multi-modal input (drag a PDF first, then click)',
};

interface PromptItem {
  readonly text: string;
  readonly capability?: Capability;
  readonly requiresAttachment?: boolean;
}

interface PromptGroup {
  readonly id: string;
  readonly title: string;
  readonly prompts: readonly PromptItem[];
}

/**
 * Dedup prompts across groups. Walk in order; the first appearance
 * of a text wins, later duplicates are dropped. Groups that end up
 * empty are filtered out so we don't render lone headers. Normalises
 * by trimming + lower-casing so trivial whitespace / case variants
 * are treated as the same prompt.
 */
function dedupPromptGroups(groups: readonly PromptGroup[]): readonly PromptGroup[] {
  const seen = new Set<string>();
  const out: PromptGroup[] = [];
  for (const g of groups) {
    const keptPrompts: PromptItem[] = [];
    for (const p of g.prompts) {
      const key = p.text.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      keptPrompts.push(p);
    }
    if (keptPrompts.length > 0) {
      out.push({ id: g.id, title: g.title, prompts: keptPrompts });
    }
  }
  return out;
}

// Curated example prompts grouped by domain. Capability tags (F1,
// F1-dyn, F2, F3, F4, F5, F6) badge each prompt so operators see at
// a glance which library capability the prompt exercises. The
// synthetic "Recent" group is prepended dynamically in
// promptGroups() when the user has clicked any prompt this session;
// dedupPromptGroups() drops any overlap between recent + topical.
const PROMPT_GROUPS: readonly PromptGroup[] = [
  {
    id: 'custodians',
    title: 'Custodians',
    prompts: [
      // ── Three intake variants, side by side so operators see the trade-offs:
      // F1     = predefined form mounts inline in the chat panel (no routing)
      // F1-dyn = LLM authors the form on the fly, still mounts in chat
      // (no-tag) = pure navigation to the standalone /intake/custodian page
      { text: 'Onboard a custodian from the Finance team', capability: 'F1' },
      { text: 'Generate a custodian intake form yourself, ask me name, email, department, and any compliance acknowledgements you think are needed', capability: 'F1-dyn' },
      { text: 'Go to the custodian intake page for a Finance custodian' },
      // ── Domain prompts that exercise the intake side-effects + listing:
      { text: 'Onboard a Finance custodian named Alice Chen, alice.chen@acme.example', capability: 'F1' },
      { text: 'Onboard a custodian, type Eleanor for the supervisor', capability: 'F2' },
      { text: 'Add Sarah Chen as a custodian, sarah.chen@acme.example, Engineering' },
      { text: 'List all custodians on this matter' },
    ],
  },
  {
    id: 'holds',
    title: 'Legal holds',
    prompts: [
      // ── Two wizard variants, side by side (matches the Custodian
      //    intake pattern):
      // F3        = wizard mounts inline in the chat panel
      // (no-tag)  = pure navigation to /workflows/place-hold, no chat card
      { text: 'Open the place-legal-hold wizard', capability: 'F3' },
      { text: 'Go to the place-legal-hold wizard page' },
      { text: 'Run the multi-actor place-hold-and-collect workflow', capability: 'F3' },
      { text: 'Place a legal hold on Sarah Chen — scope: emails about Project Phoenix from Jan 2025' },
      { text: 'Show me pending hold acknowledgements' },
      { text: 'Show me all legal holds' },
    ],
  },
  {
    id: 'review',
    title: 'Search & review',
    prompts: [
      { text: "Search documents tagged 'responsive' but not 'privileged'" },
      { text: 'Find documents about Project Phoenix' },
      { text: 'Tag DOC-7891240 as privileged — work-product' },
      { text: 'Mark DOC-7891236 as attorney-client privileged' },
    ],
  },
  {
    id: 'productions',
    title: 'Productions',
    prompts: [
      { text: 'Create production set PROD-002 with the responsive non-privileged docs from January' },
    ],
  },
  {
    id: 'approvals',
    title: 'Approvals (HITL)',
    prompts: [
      { text: 'Show me pending approvals', capability: 'F4' },
      { text: "Release HOLD-001, it's redundant", capability: 'F4' },
      { text: 'Open the approvals queue', capability: 'F4' },
    ],
  },
  {
    id: 'operations',
    title: 'Long-running operations',
    prompts: [
      { text: 'Show me long-running operations', capability: 'F5' },
      { text: 'Run TAR classification on the un-tagged corpus for SEC inquiry', capability: 'F5' },
      { text: 'List currently running operations', capability: 'F5' },
    ],
  },
  {
    id: 'multimodal',
    title: 'Multi-modal',
    prompts: [
      {
        text: 'Apply this rubric to the un-tagged set',
        capability: 'F6',
        requiresAttachment: true,
      },
    ],
  },
  // ── ADR-046 + ADR-047 — agentic workspace, layout, and dashboard
  //    surfaces. The agent can drive these end-to-end via tools; the
  //    user can also self-serve via the page-level UI affordances.
  {
    id: 'workspace',
    title: 'Workspace (agent-driven)',
    prompts: [
      { text: 'Open document preview, tag panel, and chain-of-custody in a workspace' },
      { text: 'Show me a 60/40 split with the document on the left and annotations on the right' },
      { text: 'Reshape the workspace to focus on the privilege log' },
      { text: 'Reset the workspace layout' },
    ],
  },
  {
    id: 'layout-edits',
    title: 'Layout edits (slot-level)',
    prompts: [
      { text: 'Add a chain-of-custody footer to my current workspace' },
      { text: 'Drop the sidebar' },
      { text: 'Replace the primary slot with the privilege log' },
      { text: 'List approved layout templates' },
      { text: 'Apply the privilege-review-v3 template' },
    ],
  },
  {
    id: 'dashboards',
    title: 'Dashboards (compose + apply)',
    prompts: [
      { text: 'Build me a dashboard for production status' },
      { text: 'Show me a matter health dashboard' },
      { text: 'List approved dashboard templates' },
      { text: 'Apply the matter-health-snapshot template' },
      { text: 'Update the production dashboard to also show audit context' },
    ],
  },
  // Slice A — real document review prompts. These go through the
  // `tagDocument` / `bulkTagDocuments` / `generatePrivilegeLog` tools
  // and produce real persisted state changes with chain-hashed audit.
  {
    id: 'document-review',
    title: 'Document review (Slice A)',
    prompts: [
      { text: 'Tag DOC-7891240 as privileged with work-product basis' },
      { text: 'Tag DOC-7891245 as responsive' },
      { text: 'Bulk-tag DOC-7891240, DOC-7891245, DOC-7891252 as responsive' },
      { text: 'Mark DOC-7891236 as attorney-client privileged' },
      { text: 'Generate the privilege log for this matter' },
      { text: "Show me what's in the privilege log right now" },
    ],
  },
];

/**
 * Right-rail wrapper for `<mvk-chat-shell>`. Adds an enterprise-grade
 * chrome — agent identity badge, capability counter, collapse toggle —
 * and surfaces the active persona so the user can see what scope they're
 * speaking from. The actual chat surface is unchanged: this is just a
 * presentational frame.
 */
@Component({
  selector: 'app-chat-rail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChatShellComponent, IconComponent],
  host: { '[class.collapsed]': 'collapsed()' },
  template: `
    <aside class="rail">
      @if (collapsed()) {
        <button type="button" class="reopen" (click)="toggle()" aria-label="Open coordinator">
          <svg-icon name="message" [size]="20" />
          <span class="vlabel">Coordinator</span>
        </button>
      } @else {
        <header>
          <div class="title">
            <span class="dot"></span>
            <div>
              <strong>Matter Coordinator</strong>
              <span class="sub">{{ specialistsLabel() }}</span>
            </div>
          </div>
          <div class="actions">
            <span class="caps" [attr.title]="capsTitle()">
              <svg-icon name="bolt" [size]="13" /> {{ toolCount() }}
            </span>
            <!-- Try-asking toggle. Same icon-btn pattern as cycleVerbosity
                 + collapse below — guaranteed to be clickable. Toggles
                 the hints-pane overlay on top of the chat-shell. -->
            <button type="button" class="icon-btn" [class.active]="showHints()"
                    (click)="toggleHintsOverlay()"
                    [attr.title]="showHints() ? 'Hide prompts' : 'Show prompts (' + totalPromptCount() + ')'"
                    aria-label="Toggle prompts">
              <svg-icon name="spark" [size]="14" />
            </button>
            <button type="button" class="icon-btn" (click)="cycleVerbosity()"
                    [attr.title]="'Tool-call detail: ' + verbosity() + ' (click to cycle)'"
                    aria-label="Cycle tool-call detail">
              <svg-icon [name]="verbosity() === 'full' ? 'eye' : verbosity() === 'compact' ? 'spark' : 'close'" [size]="14" />
            </button>
            <button type="button" class="icon-btn" (click)="toggle()" aria-label="Collapse">
              <svg-icon name="chevron-right" [size]="16" />
            </button>
          </div>
        </header>
        <div class="persona-strip">
          <svg-icon name="users" [size]="13" />
          <span>Speaking as <strong>{{ persona() }}</strong> · {{ persona() === 'lead-counsel' ? 'full access' : 'scoped tools' }}</span>
        </div>
        <!-- Prominent Try-asking button below persona-strip — always
             visible so prompt discovery is obvious. Toggles the same
             overlay as the ⚡ icon in the header. -->
        <button type="button" class="try-asking-toggle"
                [class.active]="showHints()"
                (click)="toggleHintsOverlay()"
                [attr.aria-expanded]="showHints()">
          <svg-icon name="spark" [size]="14" />
          <span class="ta-label">Try asking the agent</span>
          <span class="ta-badge">{{ totalPromptCount() }} prompts</span>
          <svg-icon name="chevron-right" [size]="14" class="ta-chevron" />
        </button>
        <!-- Chat shell — always mounted; takes the whole rail body
             below the Try-asking button. Transcript state is
             preserved across overlay open/close. -->
        <div class="chat-host">
          <mvk-chat-shell #chatShell [showToolCalls]="verbosity()" />
        </div>
        <!-- Hints overlay — slides over the chat-shell when toggled
             via the ⚡ icon in the header. Positioned absolute inside
             .rail so it doesn't compete with the chat for vertical
             space, and the chat-shell never re-mounts. -->
        <div class="hints-overlay" [class.open]="showHints()">
          <header class="hints-overlay-head">
            <strong>💡 Try asking</strong>
            <span class="dim">{{ totalPromptCount() }} prompts</span>
            <button type="button" class="icon-btn close"
                    (click)="toggleHintsOverlay()" aria-label="Close prompts">
              <svg-icon name="close" [size]="14" />
            </button>
          </header>
          <p class="hints-intro">
            Click a prompt to send it to the coordinator. Every prompt routes through
            a tool — actions are audit-chained.
          </p>
          <div class="hint-groups">
            @for (group of promptGroups(); track group.id) {
              <section class="hint-group">
                <h4>{{ group.title }}</h4>
                <div class="hint-items">
                  @for (p of group.prompts; track p.text) {
                    <button type="button" class="hint-item"
                            [class.disabled]="p.requiresAttachment"
                            [class.just-sent]="lastSent() === p.text"
                            [disabled]="p.requiresAttachment"
                            [attr.title]="p.requiresAttachment ? 'Drag a PDF onto the chat first, then click' : (lastSent() === p.text ? 'Just sent — wait for the agent to finish' : 'Send this prompt')"
                            (click)="runPromptFromOverlay(p.text)">
                      @if (p.capability) {
                        <span class="cap-badge cap-{{p.capability}}"
                              [attr.title]="capabilityTitle(p.capability)">{{ capabilityLabel(p.capability) }}</span>
                      }
                      <span class="hint-text">{{ p.text }}</span>
                      @if (p.requiresAttachment) { <span class="attach-icon" aria-hidden="true">📎</span> }
                    </button>
                  }
                </div>
              </section>
            }
          </div>
        </div>
      }
    </aside>
  `,
  styles: `
    /* Host must declare its own size + flex layout so it stretches to
       the full height of the .shell row and gives <aside class="rail">
       a real flex container to fill. Without this the host defaults to
       display:inline and the rail collapses to its content height. */
    :host {
      display: flex;
      flex-direction: column;
      width: var(--chat-w);
      flex-shrink: 0;
      min-height: 0;
      /* Stack above the main canvas — the agent overlay (post-b572ac8)
         renders mvk-workspace-layout inside <main> and some lib slot
         components can grow tall enough to be clipped behind a sibling
         that doesn't claim its own stacking context. Explicit z-index
         keeps the tab-bar reliably clickable. */
      position: relative;
      z-index: 10;
      transition: width var(--t-med);
    }
    :host(.collapsed) { width: 56px; }
    .rail {
      flex: 1; min-height: 0;
      background: var(--c-surface-0);
      border-left: 1px solid var(--c-border);
      display: flex; flex-direction: column;
      /* Containing block for .hints-overlay (position: absolute inset:0).
         Overflow hidden so the slide-in animation is clipped to the
         rail bounds rather than spilling over the main canvas. */
      position: relative;
      overflow: hidden;
    }
    .reopen {
      flex: 1; background: transparent; border: 0; cursor: pointer;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: var(--s-3); color: var(--c-text-mute);
      transition: color var(--t-fast), background var(--t-fast);
    }
    .reopen:hover { color: var(--c-brand); background: var(--c-surface-1); }
    .vlabel {
      writing-mode: vertical-rl; transform: rotate(180deg);
      font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;
    }

    header {
      display: flex; align-items: center; justify-content: space-between;
      padding: var(--s-4) var(--s-4) var(--s-3);
      border-bottom: 1px solid var(--c-divider);
    }
    .title { display: flex; align-items: center; gap: var(--s-3); }
    .title strong { display: block; font-size: var(--fs-sm); font-weight: 600; }
    .title .sub { font-size: 0.7rem; color: var(--c-text-mute); }
    .dot {
      width: 9px; height: 9px; border-radius: 999px;
      background: var(--c-ok); box-shadow: 0 0 0 4px var(--c-ok-soft);
      flex-shrink: 0;
    }
    .actions { display: flex; align-items: center; gap: var(--s-2); }
    .caps {
      display: inline-flex; align-items: center; gap: 0.25rem;
      padding: 2px 8px; background: var(--c-brand-tint); color: var(--c-brand-strong);
      border-radius: var(--r-pill); font-size: 0.7rem; font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .icon-btn {
      width: 28px; height: 28px; padding: 0; background: transparent;
      border: 1px solid transparent; border-radius: var(--r-sm);
      display: inline-flex; align-items: center; justify-content: center;
      color: var(--c-text-mute); cursor: pointer;
    }
    .icon-btn:hover { background: var(--c-surface-2); color: var(--c-text); }

    .persona-strip {
      display: flex; align-items: center; gap: var(--s-2);
      padding: 0.4rem var(--s-4);
      background: var(--c-surface-1);
      border-bottom: 1px solid var(--c-divider);
      font-size: 0.7rem; color: var(--c-text-mute);
    }
    .persona-strip strong { color: var(--c-text); text-transform: capitalize; }

    /* Prominent Try-asking toggle below persona-strip. Same
       visual weight as the matter selector in the header so users
       can't miss it. Two triggers (this button + the ⚡ icon in
       the header) both flip the showHints signal. */
    .try-asking-toggle {
      display: flex; align-items: center; gap: var(--s-2);
      padding: 0.55rem var(--s-4);
      background: var(--c-surface-1);
      border: 0; border-bottom: 1px solid var(--c-divider);
      border-left: 3px solid var(--c-brand);
      cursor: pointer; width: 100%; text-align: left;
      font-family: inherit; color: var(--c-text);
      transition: background var(--t-fast), border-left-color var(--t-fast);
      flex-shrink: 0;
    }
    .try-asking-toggle:hover { background: var(--c-surface-2); }
    .try-asking-toggle.active {
      background: var(--c-brand-tint);
      border-left-color: var(--c-brand-strong);
    }
    .try-asking-toggle .ta-label {
      flex: 1; font-size: var(--fs-sm); font-weight: 500;
    }
    .try-asking-toggle .ta-badge {
      padding: 1px 7px; border-radius: var(--r-pill);
      background: var(--c-surface); color: var(--c-text-mute);
      font-size: 0.65rem; font-variant-numeric: tabular-nums;
    }
    .try-asking-toggle.active .ta-badge {
      background: var(--c-brand); color: white;
    }
    .try-asking-toggle .ta-chevron {
      color: var(--c-text-mute);
      transition: transform var(--t-fast);
    }
    .try-asking-toggle.active .ta-chevron { transform: rotate(90deg); }
    /* Hints overlay — slides over the chat-shell when toggled from
       the header ⚡ icon. Positioned absolute inside .rail (which
       has position:relative) so it doesn't compete with chat for
       vertical space; chat stays mounted underneath. */
    .icon-btn.active {
      background: var(--c-brand-tint); color: var(--c-brand-strong);
      border-color: var(--c-brand);
    }
    .hints-overlay {
      position: absolute; inset: 0;
      background: var(--c-surface-0);
      transform: translateX(100%);
      transition: transform 180ms ease-out;
      display: flex; flex-direction: column;
      z-index: 15;
      pointer-events: none;
    }
    .hints-overlay.open {
      transform: translateX(0);
      pointer-events: auto;
      box-shadow: -4px 0 14px rgba(0,0,0,0.06);
    }
    .hints-overlay-head {
      display: flex; align-items: center; gap: var(--s-2);
      padding: var(--s-3) var(--s-4);
      border-bottom: 1px solid var(--c-divider);
      background: var(--c-surface-1);
    }
    .hints-overlay-head strong { font-size: var(--fs-sm); }
    .hints-overlay-head .dim { color: var(--c-text-mute); font-size: var(--fs-xs); }
    .hints-overlay-head .close { margin-left: auto; }
    /* Overlay body — the .hints-intro + .hint-groups + .hint-item
       rules below already exist; we just need to give the body a
       scrollable region so long prompt catalogs work in the rail. */
    .hints-overlay > .hints-intro { margin: var(--s-3) var(--s-4) 0; }
    .hints-overlay > .hint-groups {
      flex: 1; min-height: 0; overflow-y: auto;
      padding: var(--s-3) var(--s-4) var(--s-4);
    }
    .hints-intro {
      margin: 0 0 var(--s-3); padding: var(--s-2) var(--s-3);
      background: var(--c-surface-1); border-left: 3px solid var(--c-brand);
      border-radius: var(--r-sm);
      font-size: 0.72rem; color: var(--c-text-2); line-height: 1.4;
    }

    /* Legacy hints styles kept so any other reference doesn't break. */
    .hints {
      padding: var(--s-2) var(--s-4) var(--s-2);
      border-bottom: 1px solid var(--c-divider);
      flex-shrink: 0;
    }
    .hints.expanded { max-height: 320px; overflow-y: auto; }
    .hint-toggle {
      width: 100%; display: flex; align-items: center; gap: var(--s-2);
      padding: 0.35rem 0.1rem; background: transparent; border: 0; cursor: pointer;
      color: var(--c-text-mute);
    }
    .hint-toggle:hover { color: var(--c-text); }
    .hint-title {
      flex: 1; text-align: left;
      font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--c-text-faint); font-weight: 600;
    }
    .hint-meta {
      font-size: 0.65rem; color: var(--c-text-mute);
      padding: 1px 6px; background: var(--c-surface-2); border-radius: var(--r-pill);
      font-variant-numeric: tabular-nums;
    }
    .hint-groups { display: grid; gap: var(--s-2); padding-top: 4px; }
    .hint-group h4 {
      margin: 0 0 4px; font-size: 0.6rem; font-weight: 700; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--c-text-mute);
    }
    .hint-items { display: grid; gap: 3px; }
    .hint-item {
      display: flex; align-items: center; gap: 0.4rem;
      width: 100%; padding: 0.35rem 0.55rem; text-align: left;
      background: var(--c-surface-1); border: 1px solid var(--c-border);
      border-radius: var(--r-sm); font-size: 0.74rem; color: var(--c-text-2);
      cursor: pointer; transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
      font-family: inherit;
    }
    .hint-item:hover:not(:disabled) {
      background: var(--c-brand-tint); border-color: var(--c-brand-soft);
      color: var(--c-brand-strong);
    }
    .hint-item.disabled, .hint-item:disabled {
      opacity: 0.55; cursor: not-allowed;
    }
    /* Highlight the prompt the operator just clicked. Auto-clears
       4s later; gives a clear "sent — wait for the agent" signal
       so a rapid second click doesn't abort the prior turn. */
    .hint-item.just-sent {
      background: var(--c-brand-tint);
      border-color: var(--c-brand);
      color: var(--c-brand-strong);
      box-shadow: 0 0 0 2px var(--c-brand-soft);
      animation: just-sent-pulse 1.6s ease-out 1;
    }
    @keyframes just-sent-pulse {
      0%   { box-shadow: 0 0 0 0 var(--c-brand-soft); }
      40%  { box-shadow: 0 0 0 6px transparent; }
      100% { box-shadow: 0 0 0 2px var(--c-brand-soft); }
    }
    .hint-item .hint-text { flex: 1; line-height: 1.25; }
    .hint-item .attach-icon { font-size: 0.85rem; flex-shrink: 0; }
    .cap-badge {
      flex-shrink: 0;
      font-size: 0.58rem; font-weight: 700;
      padding: 1px 5px; border-radius: 3px;
      letter-spacing: 0.04em; font-variant-numeric: tabular-nums;
      color: white; line-height: 1.4;
    }
    .cap-F1 { background: #2563eb; }  /* blue — composable form (predefined) */
    /* F1* — agent-generated form (Approach 2). Same blue family, but a
       gradient hints at "the LLM authored this". CSS class name uses
       a numeric suffix because '*' isn't a valid bare class char. */
    .cap-F1-dyn { background: linear-gradient(90deg, #2563eb 0%, #db2777 100%); }
    .cap-F2 { background: #0891b2; }  /* cyan — live data */
    .cap-F3 { background: #7c3aed; }  /* violet — workflow */
    .cap-F4 { background: #d97706; }  /* amber — approval */
    .cap-F5 { background: #059669; }  /* green — long-running */
    .cap-F6 { background: #db2777; }  /* pink — multi-modal */
    .hint-chevron { transition: transform var(--t-fast); }
    .hint-chevron.rotated { transform: rotate(180deg); }

    .chat-host {
      flex: 1; min-height: 0;
      padding: var(--s-2) var(--s-2) var(--s-3);
      display: flex; flex-direction: column;
    }
    .chat-host mvk-chat-shell { flex: 1; min-height: 0; }
  `,
})
export class ChatRailComponent {
  private readonly toolRegistry = inject(ToolRegistry);
  private readonly capabilityRegistry = inject(CapabilityRegistry);
  private readonly personaService = inject(PersonaService);
  private readonly bridge = inject(ChatBridgeService);
  private readonly chatShell = viewChild<ChatShellComponent>('chatShell');

  protected readonly toolCount = computed(() => this.toolRegistry.signal().length);
  protected readonly persona = this.personaService.active;
  protected readonly capsTitle = computed(() =>
    `${this.toolCount()} tools registered (Phase 7's permission shim will hide what '${this.persona()}' can't invoke)`,
  );
  protected readonly specialistsLabel = computed(() => {
    const n = this.capabilityRegistry.signal().length;
    return n === 0 ? 'Collection (host)' : `Collection (host) + ${n} federated`;
  });

  protected readonly collapsed = signal(false);
  toggle(): void { this.collapsed.update((v) => !v); }

  constructor() {
    // Register the chat shell with the app-wide bridge so non-chat
    // surfaces (Cmd+K palette, dashboard smart-buttons) can route
    // prompts through THIS chat instance. Re-runs whenever the
    // viewChild resolves (`chatShell()` is a signal of the ref).
    effect(() => {
      const shell = this.chatShell();
      this.bridge.register(shell ?? null);
    });
    // Expose an "open the rail" hook so the palette can ensure the
    // chat is visible when it forwards a prompt.
    this.bridge.registerOpener(() => {
      if (this.collapsed()) this.collapsed.set(false);
    });
  }

  /** Curated topical groups with dedup pass applied. Recent /
   *  latest synthetic groups were dropped in 2026-05-11 -- the
   *  topical sections (Custodians / Legal holds / …) already carry
   *  every prompt with its capability tag; a "Recent" overlay was
   *  redundant and confused operators. */
  protected readonly promptGroups = computed<readonly PromptGroup[]>(() =>
    dedupPromptGroups(PROMPT_GROUPS),
  );

  protected readonly totalPromptCount = computed(() =>
    this.promptGroups().reduce((sum, g) => sum + g.prompts.length, 0),
  );
  /** Default-expanded — kept for back-compat; tabs replaced the inline
   *  collapse in the new layout but other code paths may still query. */
  protected readonly hintsExpanded = signal(true);
  toggleHints(): void { this.hintsExpanded.update((v) => !v); }

  /**
   * Hints overlay open/closed. Toggled by the ⚡ icon in the rail
   * header. When open, the prompts pane slides over the chat-shell;
   * chat stays mounted underneath so the transcript is preserved.
   * Closed by default — the chat composer gets the full rail height
   * unless the user explicitly asks to see prompts.
   */
  protected readonly showHints = signal(false);
  toggleHintsOverlay(): void { this.showHints.update((v) => !v); }

  /** Click a prompt in the overlay → fire it AND close the overlay
   *  so the user immediately sees the agent's reply. */
  runPromptFromOverlay(text: string): void {
    this.runPrompt(text);
    this.showHints.set(false);
  }

  protected capabilityLabel(c: Capability): string { return CAPABILITY_LABEL[c]; }
  protected capabilityTitle(c: Capability): string { return CAPABILITY_TITLE[c]; }

  /**
   * Send a curated prompt as if the user typed it. The prompt panel
   * collapses after submit so the transcript has the rail's full height.
   */
  /** Last prompt the operator clicked, kept in a signal so the
   *  template can fade the item briefly. Cleared 4s later. */
  protected readonly lastSent = signal<string>('');

  runPrompt(text: string): void {
    const shell = this.chatShell();
    if (!shell) return;
    // sendMessage on the chat shell aborts any prior in-flight
    // turn. We do NOT auto-collapse the hints panel here -- the
    // operator wanted to keep browsing prompts; collapsing made the
    // panel feel "stuck" after a couple of clicks.
    shell.sendMessage(text);
    this.lastSent.set(text);
    setTimeout(() => {
      if (this.lastSent() === text) this.lastSent.set('');
    }, 4000);
  }

  /**
   * Tool-call rendering mode forwarded into the library's chat shell.
   * Cycles `compact` → `hidden` → `full` so a viewer can quickly
   * compare the three transcript styles. Defaults to `compact`: tool
   * names are visible (so the user knows the agent acted) but the
   * args/result JSON is hidden — the widget below the bubble is the
   * visible result.
   */
  protected readonly verbosity = signal<'full' | 'compact' | 'hidden'>('compact');
  cycleVerbosity(): void {
    this.verbosity.update((v) =>
      v === 'compact' ? 'hidden' : v === 'hidden' ? 'full' : 'compact',
    );
  }
}
