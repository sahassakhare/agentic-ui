import { NgClass } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { IntentRegistry } from '../registries/intent-registry';
import type { IntentDef, IntentTarget } from '../types/registry-defs';

/**
 * One resolved menu row — `IntentDef` projection ready for render.
 *
 * Carries the intent's `mapsTo` target verbatim so the host's
 * `(selected)` handler can dispatch by `kind` (tool / action / route)
 * without a second registry lookup.
 */
export interface RowActionResult {
  readonly intentId: string;
  readonly mapsTo: IntentTarget;
  readonly row: unknown;
  readonly entity?: string;
  readonly label: string;
  readonly description?: string;
}

/**
 * Predicate to additionally filter intents against the current row's
 * state — *"only show releaseHold when row.status === 'active'"*.
 *
 * Applied after `IntentRegistry.get()` (which already applies
 * `setScopePolicy` for persona scope). Defaults to allow-all so the
 * menu shows every resolved intent.
 */
export type RowIntentFilter = (intent: IntentDef, row: unknown) => boolean;

/**
 * Per-row context menu — Pillar 1 pattern 2 of
 * [post-chat-surfaces-plan.md](../../../../docs/plans/post-chat-surfaces-plan.md).
 *
 * Renders a kebab (`⋮`) button per row. On click opens a dropdown
 * populated with the intents whose names the host listed in
 * `[intents]` AND which (a) the active persona can see via
 * `IntentRegistry.get()` (which applies `setScopePolicy`) AND (b)
 * the optional `[filter]` predicate accepts for the current row's
 * state.
 *
 * On selection the component emits a typed `RowActionResult` with
 * the intent's `mapsTo` target verbatim — the host's handler
 * switches on `mapsTo.kind` to dispatch (tool / action / route).
 * Same dispatch-agnostic pattern as `<mvk-cmd-k-palette>`.
 *
 * @example
 * ```html
 * <mvk-row-action-menu
 *   [row]="custodian"
 *   entity="custodian"
 *   [intents]="['runHoldAck', 'openInReview', 'showCommsTimeline']"
 *   [filter]="rowFilter"
 *   (selected)="onAction($event)" />
 * ```
 *
 * @example
 * ```ts
 * rowFilter: RowIntentFilter = (intent, row) => {
 *   if (intent.id === 'releaseHold' && row.status !== 'active') return false;
 *   return true;
 * };
 * onAction(r: RowActionResult): void {
 *   if (r.mapsTo.kind === 'route') this.router.navigateByUrl(r.mapsTo.target);
 *   else this.chat.sendMessage(`${r.intentId}: ${JSON.stringify(r.row)}`);
 * }
 * ```
 *
 * Keyboard: kebab is keyboard-focusable. Enter / Space opens the menu;
 * Esc closes it; Arrow keys navigate; Enter selects the highlighted
 * row. Click outside closes.
 */
@Component({
  selector: 'mvk-row-action-menu',
  imports: [NgClass],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="kebab"
      aria-label="Row actions"
      [attr.aria-expanded]="isOpen()"
      aria-haspopup="menu"
      (click)="toggle($event)"
      (keydown.enter)="open()"
      (keydown.space)="open(); $event.preventDefault()">⋮</button>
    @if (isOpen()) {
      <ul class="menu" role="menu" (keydown)="onKeydown($event)">
        @for (row of rows(); track row.intentId; let i = $index) {
          <li class="row"
              role="menuitem"
              tabindex="-1"
              [ngClass]="{ active: i === highlighted() }"
              [attr.aria-selected]="i === highlighted()"
              (mouseenter)="highlighted.set(i)"
              (click)="select(row)">
            <span class="kind" [attr.data-kind]="row.mapsTo.kind">{{ row.mapsTo.kind }}</span>
            <span class="label">{{ row.label }}</span>
          </li>
        } @empty {
          <li class="row empty" role="menuitem" tabindex="-1">No actions for this row.</li>
        }
      </ul>
    }
  `,
  styles: `
    :host { display: inline-block; position: relative; }
    .kebab {
      background: transparent; border: 0; color: #4b5563;
      width: 1.8rem; height: 1.8rem; padding: 0;
      border-radius: 0.3rem; cursor: pointer;
      font-size: 1.1rem; line-height: 1;
    }
    .kebab:hover { background: #f3f4f6; }
    .kebab:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; }
    .menu {
      position: absolute; right: 0; top: calc(100% + 4px);
      list-style: none; margin: 0; padding: 0.3rem 0;
      background: white; border: 1px solid #e5e7eb; border-radius: 0.4rem;
      box-shadow: 0 6px 24px rgba(15, 23, 42, 0.14);
      min-width: 220px; z-index: 30;
    }
    .row {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.45rem 0.7rem; cursor: pointer; font-size: 0.9em;
    }
    .row.active { background: #eef2ff; }
    .row.empty { color: #9ca3af; cursor: default; }
    .kind {
      padding: 0.05rem 0.4rem; border-radius: 999px;
      font-size: 0.65em; font-weight: 600; text-transform: uppercase;
      color: white; background: #6366f1;
      flex-shrink: 0;
    }
    .kind[data-kind="tool"] { background: #2563eb; }
    .kind[data-kind="action"] { background: #16a34a; }
    .kind[data-kind="route"] { background: #ea580c; }
    .label { color: #111827; }
  `,
})
export class RowActionMenuComponent {
  /** The row state — forwarded into `[filter]` and the `(selected)` payload. */
  readonly row = input.required<unknown>();

  /** Names of intents (`IntentDef.id`) to consider for this row. */
  readonly intents = input<readonly string[]>([]);

  /**
   * Optional entity-type tag (`'custodian'`, `'document'`, ...). Forwarded
   * into the `(selected)` payload so audit-chain entries can attribute
   * the action to the entity kind.
   */
  readonly entity = input<string | undefined>(undefined);

  /**
   * Optional row-state predicate. Applied after persona scope and the
   * `[intents]` allow-list. Returning `false` hides that intent for
   * this specific row.
   */
  readonly filter = input<RowIntentFilter>(() => true);

  /** Emits when the user picks a row. The menu closes itself before emitting. */
  readonly selected = output<RowActionResult>();

  protected readonly isOpen = signal(false);
  protected readonly highlighted = signal(0);

  private readonly registry = inject(IntentRegistry);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Resolved menu rows — persona-filtered via `IntentRegistry.get()`
   * then row-filtered via `[filter]`. Recomputes when intents list,
   * scope policy, row state, or filter input changes.
   */
  protected readonly rows = computed<readonly RowActionResult[]>(() => {
    const filter = this.filter();
    const row = this.row();
    const entity = this.entity();
    const out: RowActionResult[] = [];
    for (const id of this.intents()) {
      const def = this.registry.get(id);
      if (!def) continue;                                // persona-blocked / unregistered
      if (!filter(def, row)) continue;                   // row-state predicate
      out.push({
        intentId: def.id,
        mapsTo: def.mapsTo,
        row,
        entity,
        label: def.description || def.name,
        description: def.examples[0],
      });
    }
    return out;
  });

  protected toggle(ev: MouseEvent): void {
    ev.stopPropagation();
    if (this.isOpen()) this.close();
    else this.open();
  }

  protected open(): void {
    this.isOpen.set(true);
    this.highlighted.set(0);
  }

  protected close(): void {
    this.isOpen.set(false);
  }

  protected onKeydown(ev: KeyboardEvent): void {
    const rows = this.rows();
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      this.highlighted.update((i) => Math.min(rows.length - 1, i + 1));
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      this.highlighted.update((i) => Math.max(0, i - 1));
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const row = rows[this.highlighted()];
      if (row) this.select(row);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      this.close();
    }
  }

  protected select(row: RowActionResult): void {
    this.close();
    this.selected.emit(row);
  }

  /** Close on any click outside the kebab + menu. */
  @HostListener('document:mousedown', ['$event'])
  protected onDocumentMousedown(ev: MouseEvent): void {
    if (!this.isOpen()) return;
    if (!this.host.nativeElement.contains(ev.target as Node)) {
      this.close();
    }
  }

  /** Close on Escape from anywhere in the document. */
  @HostListener('document:keydown.escape')
  protected onGlobalEscape(): void {
    if (this.isOpen()) this.close();
  }
}
