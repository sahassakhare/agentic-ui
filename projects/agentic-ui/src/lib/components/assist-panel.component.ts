import { NgClass } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IntentRegistry } from '../registries/intent-registry';
import { LAYOUT_POLICY } from '../layout/types';
import type { IntentDef, IntentTarget } from '../types/registry-defs';

/**
 * One suggested next-action — same shape as `RowActionResult` /
 * `BulkActionResult` so a single host dispatcher handles all of P1.
 */
export interface AssistAction {
  readonly intentId: string;
  readonly mapsTo: IntentTarget;
  readonly label: string;
  readonly description?: string;
}

/**
 * Optional row-state predicate against a host-supplied "current
 * context" payload (e.g. the current custodian, the open document).
 * Lets the host hide suggestions that aren't applicable for *this*
 * state without filtering the intents allow-list per-route.
 */
export type AssistIntentFilter = (intent: IntentDef, context: unknown) => boolean;

/**
 * Structured-affordance panel — Pillar 1 pattern 6 (the Cursor/Copilot
 * shape) from [post-chat-surfaces-plan.md](../../../../docs/plans/post-chat-surfaces-plan.md).
 *
 * Pairs with `<mvk-chat-shell mode="assist-panel">` from ADR-043 — when
 * the chat shell's mode resolves to `assist-panel`, the host typically
 * renders this component in the side pane instead of the chat
 * transcript. The panel shows four agent-presence affordances at once:
 *
 * 1. **Context summary.** `[context]` — a short string the host
 *    computes ("Editing custodian C-117 intake"). Pure presentation;
 *    the host owns the wording.
 * 2. **Suggested next actions.** Intents resolved through the same
 *    three-stage filter chain as `<mvk-row-action-menu>` —
 *    allow-list + persona scope + optional `[filter]` predicate.
 *    Clicking emits `(intentSelected)` with the typed `mapsTo`.
 * 3. **"Explain this" affordance.** When `[focusedItem]` is set,
 *    a small "Explain {focusLabel}" button surfaces; clicking emits
 *    `(explain)` with the item payload.
 * 4. **Scoped chat input.** A small text input at the bottom; submit
 *    emits `(ask)` with the typed text. The host wires it through
 *    `AgenticChatRef.sendMessage` (or wherever).
 *
 * Persona density (ADR-043 D4): when `LAYOUT_POLICY.density()` returns
 * `'dense'` or `'compact'`, the panel reduces internal padding. Default
 * is `'comfortable'`. Existing `<mvk-chat-shell />` consumers see no
 * change because they don't render this component.
 *
 * Dispatch-agnostic, same as every other P1 surface. The component
 * never executes anything — events flow out, host wires the actual
 * tool / action / route dispatch.
 *
 * @example
 * ```html
 * <mvk-assist-panel
 *   [context]="'Editing custodian ' + custodian.name"
 *   [intents]="['runHoldAck', 'openInReview', 'showCommsTimeline']"
 *   [filter]="contextFilter"
 *   [focusedItem]="focusedField"
 *   focusLabel="this field"
 *   (intentSelected)="onAction($event)"
 *   (explain)="onExplain($event)"
 *   (ask)="onAsk($event)" />
 * ```
 */
@Component({
  selector: 'mvk-assist-panel',
  imports: [FormsModule, NgClass],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="panel" [attr.data-density]="density()" role="complementary" aria-label="Agent assist">
      @if (context()) {
        <header class="context">
          <span class="badge" aria-hidden="true">⌬</span>
          <span class="summary">{{ context() }}</span>
        </header>
      }

      <section class="actions" aria-labelledby="actions-heading">
        <h3 id="actions-heading" class="heading">Suggested next</h3>
        @if (resolved().length > 0) {
          <ul class="action-list" role="list">
            @for (a of resolved(); track a.intentId) {
              <li>
                <button type="button"
                        class="action"
                        [ngClass]="'kind-' + a.mapsTo.kind"
                        (click)="onAction(a)">
                  <span class="kind" [attr.data-kind]="a.mapsTo.kind">{{ a.mapsTo.kind }}</span>
                  <span class="label">{{ a.label }}</span>
                  @if (a.description) {
                    <span class="desc">{{ a.description }}</span>
                  }
                </button>
              </li>
            }
          </ul>
        } @else {
          <p class="empty">No suggested actions for this view.</p>
        }
      </section>

      @if (focusedItem() !== undefined && focusedItem() !== null) {
        <section class="explain-section" aria-labelledby="explain-heading">
          <h3 id="explain-heading" class="heading">Focused</h3>
          <button type="button" class="explain" (click)="onExplain()">
            <span class="explain-label">Explain {{ focusLabel() }}</span>
          </button>
        </section>
      }

      <section class="ask" aria-labelledby="ask-heading">
        <h3 id="ask-heading" class="heading">Ask</h3>
        <form class="ask-form" (submit)="onSubmit($event)">
          <input
            type="text"
            class="ask-input"
            [ngModel]="askText()"
            (ngModelChange)="askText.set($event)"
            name="ask"
            [placeholder]="askPlaceholder()"
            aria-label="Ask the agent"
            autocomplete="off" />
          <button type="submit"
                  class="ask-submit"
                  [disabled]="!askText().trim()">Send</button>
        </form>
      </section>
    </aside>
  `,
  styles: `
    :host { display: block; height: 100%; min-height: 0; }
    .panel {
      display: flex; flex-direction: column; gap: 1rem;
      padding: 1rem;
      height: 100%; min-height: 0;
      background: #fafafa; border-left: 1px solid #e5e7eb;
      font-family: system-ui, sans-serif; font-size: 0.9rem;
      box-sizing: border-box; overflow-y: auto;
    }
    .panel[data-density="compact"] { padding: 0.7rem; gap: 0.7rem; font-size: 0.85rem; }
    .panel[data-density="dense"]   { padding: 0.5rem; gap: 0.5rem; font-size: 0.8rem; }
    .context { display: flex; align-items: center; gap: 0.5rem; }
    .badge {
      display: inline-flex; align-items: center; justify-content: center;
      width: 1.4rem; height: 1.4rem; border-radius: 50%;
      background: #4338ca; color: white; font-size: 0.85em;
    }
    .summary { color: #1e1b4b; font-weight: 500; line-height: 1.3; }
    .heading {
      font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em;
      color: #6b7280; margin: 0 0 0.4rem 0; font-weight: 600;
    }
    .action-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
    .action {
      display: flex; align-items: center; gap: 0.45rem;
      width: 100%; padding: 0.5rem 0.7rem;
      background: white; border: 1px solid #e5e7eb;
      border-radius: 0.4rem; cursor: pointer;
      font: inherit; color: #111827;
      text-align: left;
    }
    .action:hover { background: #eef2ff; border-color: #c7d2fe; }
    .action:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; }
    .kind {
      padding: 0.05rem 0.4rem; border-radius: 999px;
      font-size: 0.65em; font-weight: 600; text-transform: uppercase;
      color: white; background: #6366f1;
      flex-shrink: 0;
    }
    .kind[data-kind="tool"] { background: #2563eb; }
    .kind[data-kind="action"] { background: #16a34a; }
    .kind[data-kind="route"] { background: #ea580c; }
    .action .label { flex: 1; font-weight: 500; }
    .action .desc { color: #6b7280; font-size: 0.85em; }
    .empty { color: #9ca3af; font-style: italic; margin: 0; }
    .explain-section { padding-top: 0.4rem; border-top: 1px dashed #e5e7eb; }
    .explain {
      display: inline-flex; align-items: center; gap: 0.4rem;
      padding: 0.4rem 0.7rem;
      background: white; border: 1px dashed #c7d2fe;
      border-radius: 0.4rem; cursor: pointer; color: #4338ca;
      font: inherit; font-weight: 500;
    }
    .explain:hover { background: #eef2ff; }
    .explain:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; }
    .ask { margin-top: auto; padding-top: 0.6rem; border-top: 1px solid #e5e7eb; }
    .ask-form { display: flex; gap: 0.4rem; }
    .ask-input {
      flex: 1; padding: 0.45rem 0.6rem;
      border: 1px solid #d1d5db; border-radius: 0.4rem;
      font: inherit; outline: 0;
    }
    .ask-input:focus { border-color: #6366f1; }
    .ask-submit {
      padding: 0.45rem 0.9rem;
      background: #2563eb; color: white; border: 0;
      border-radius: 0.4rem; font: inherit; font-weight: 600; cursor: pointer;
    }
    .ask-submit:disabled { opacity: 0.5; cursor: not-allowed; }
  `,
})
export class AssistPanelComponent {
  /** Short context string. Empty/missing → header hidden. */
  readonly context = input<string>('');

  /** Names of intents (`IntentDef.id`) to surface as suggestions. */
  readonly intents = input<readonly string[]>([]);

  /**
   * Optional context for the `[filter]` predicate. Defaults to
   * `undefined` so a host that only wants intent-allow-list +
   * persona-scope filtering can omit it.
   */
  readonly filterContext = input<unknown>(undefined);

  /**
   * Optional context predicate. Returns false to hide an intent
   * for the current view. Applied after persona scope.
   */
  readonly filter = input<AssistIntentFilter>(() => true);

  /**
   * When present (not undefined / null), an "Explain {focusLabel}"
   * button surfaces. Clicking emits `(explain)` with this payload.
   */
  readonly focusedItem = input<unknown>(undefined);

  /** Human-readable label inside the Explain button. */
  readonly focusLabel = input<string>('this');

  /** Placeholder text inside the Ask input. */
  readonly askPlaceholder = input<string>('Ask the agent…');

  /** Emits when the user clicks a suggested action. */
  readonly intentSelected = output<AssistAction>();

  /** Emits when the user clicks "Explain {focusLabel}". */
  readonly explain = output<unknown>();

  /** Emits when the user submits the Ask input. */
  readonly ask = output<string>();

  protected readonly askText = signal('');

  private readonly registry = inject(IntentRegistry);
  private readonly layoutPolicy = inject(LAYOUT_POLICY);

  /** Resolved actions — persona-filtered + context-filtered. */
  protected readonly resolved = computed<readonly AssistAction[]>(() => {
    const filter = this.filter();
    const ctx = this.filterContext();
    const out: AssistAction[] = [];
    for (const id of this.intents()) {
      const def = this.registry.get(id);
      if (!def) continue;
      if (!filter(def, ctx)) continue;
      out.push({
        intentId: def.id,
        mapsTo: def.mapsTo,
        label: def.description || def.name,
        description: def.examples[0],
      });
    }
    return out;
  });

  /** Layout density from the active `LAYOUT_POLICY` (default `'comfortable'`). */
  protected readonly density = computed(() => {
    try {
      return this.layoutPolicy.density();
    } catch {
      return 'comfortable' as const;
    }
  });

  protected onAction(a: AssistAction): void {
    this.intentSelected.emit(a);
  }

  protected onExplain(): void {
    this.explain.emit(this.focusedItem());
  }

  protected onSubmit(ev: Event): void {
    ev.preventDefault();
    const text = this.askText().trim();
    if (!text) return;
    this.ask.emit(text);
    this.askText.set('');
  }
}
