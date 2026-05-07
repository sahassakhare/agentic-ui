import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  COMPOSITION_SLOT,
  CompositionStore,
} from '@maverick/agentic-ui';
import { MatterStore } from '../services/matter.store';

/**
 * Step widgets for the `placeLegalHold` workflow (Capability F3 demo).
 *
 * Each widget injects `COMPOSITION_SLOT` (the step id) + `CompositionStore`
 * and persists its value under the step key. The renderer aggregates
 * everything into a single state record passed to `WorkflowDef.onComplete`.
 *
 * Slot keys mirror the step ids in `agenticWorkflow({steps: [...]})`:
 *   scope → readonly string[] (keywords)
 *   custodians → readonly string[] (custodian ids)
 *   date-range → { from?: string; to?: string }
 *   preview → unused by the widget itself (display-only)
 *   matter-setup → unused (placeholder when zero custodians selected)
 */

// ── Step 1: Keyword chip picker ─────────────────────────────────────────────

@Component({
  selector: 'app-place-hold-keywords',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <p class="hint">
      List the topics this hold should cover. Press Enter or comma to add a chip.
    </p>
    <div class="chips" role="list">
      @for (kw of keywords(); track kw) {
        <span class="chip" role="listitem">
          {{ kw }}
          <button type="button" class="remove" (click)="remove(kw)" aria-label="Remove">×</button>
        </span>
      }
      @if (keywords().length === 0) {
        <span class="empty">No keywords yet — try "Project Phoenix", "SEC inquiry"…</span>
      }
    </div>
    <input
      type="text"
      [ngModel]="draft()"
      (ngModelChange)="draft.set($event)"
      (keydown.enter)="commit($event)"
      (keydown.,)="commit($event)"
      placeholder="Type a keyword and press Enter"
      name="kw-draft"
    />
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 0.4rem; }
    .hint { margin: 0; color: #6b7280; font-size: 0.8rem; }
    .chips { display: flex; flex-wrap: wrap; gap: 0.3rem; min-height: 1.6rem; }
    .chip { display: inline-flex; align-items: center; gap: 0.3rem; padding: 0.2rem 0.5rem; border-radius: 999px; background: #e0e7ff; color: #3730a3; font-size: 0.8rem; }
    .chip .remove { background: transparent; border: 0; color: #4338ca; cursor: pointer; padding: 0; font-size: 1rem; line-height: 1; }
    .empty { color: #9ca3af; font-size: 0.8rem; font-style: italic; }
    input { padding: 0.4rem 0.5rem; border: 1px solid #d1d5db; border-radius: 0.3rem; font: inherit; }
  `,
})
export class PlaceHoldKeywordsComponent {
  private readonly slot = inject(COMPOSITION_SLOT, { optional: true });
  private readonly store = inject(CompositionStore, { optional: true });

  protected readonly draft = signal('');

  protected readonly keywords = computed<readonly string[]>(() => {
    if (!this.store || !this.slot) return [];
    const v = this.store.values()[this.slot];
    return Array.isArray(v) ? (v as readonly string[]) : [];
  });

  protected commit(event: Event): void {
    event.preventDefault();
    const raw = this.draft().trim();
    if (!raw || !this.store || !this.slot) return;
    const cur = this.keywords();
    if (cur.includes(raw)) {
      this.draft.set('');
      return;
    }
    this.store.write(this.slot, [...cur, raw]);
    this.draft.set('');
  }

  protected remove(kw: string): void {
    if (!this.store || !this.slot) return;
    this.store.write(this.slot, this.keywords().filter((k) => k !== kw));
  }
}

// ── Step 2: Custodian multi-select ──────────────────────────────────────────

@Component({
  selector: 'app-place-hold-custodians',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="hint">
      Select every custodian this hold should cover.
      @if (custodians().length === 0) {
        <span class="warn">No custodians on this matter yet.</span>
      }
    </p>
    <div class="grid">
      @for (c of custodians(); track c.id) {
        <label class="row">
          <input type="checkbox"
                 [checked]="isSelected(c.id)"
                 (change)="toggle(c.id)"
                 [name]="'cust-' + c.id" />
          <span class="meta">
            <strong>{{ c.name }}</strong>
            <span class="dept">{{ c.department }}</span>
            @if (c.hasLegalHold) { <span class="hold">already on hold</span> }
          </span>
        </label>
      }
    </div>
    <p class="summary">
      {{ selected().length }} of {{ custodians().length }} selected.
    </p>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 0.4rem; }
    .hint { margin: 0; color: #6b7280; font-size: 0.8rem; }
    .warn { color: #b45309; }
    .grid { display: flex; flex-direction: column; gap: 0.3rem; max-height: 200px; overflow-y: auto; padding: 0.3rem; border: 1px solid #e5e7eb; border-radius: 0.3rem; }
    .row { display: flex; align-items: flex-start; gap: 0.5rem; padding: 0.3rem; border-radius: 0.25rem; cursor: pointer; }
    .row:hover { background: #f9fafb; }
    .meta { display: flex; flex-direction: column; gap: 0.1rem; font-size: 0.85rem; }
    .dept { color: #6b7280; font-size: 0.78rem; }
    .hold { color: #b45309; font-size: 0.72rem; padding: 1px 6px; background: #fef3c7; border-radius: 999px; align-self: flex-start; }
    .summary { margin: 0; color: #6b7280; font-size: 0.78rem; }
  `,
})
export class PlaceHoldCustodiansComponent {
  private readonly slot = inject(COMPOSITION_SLOT, { optional: true });
  private readonly store = inject(CompositionStore, { optional: true });
  private readonly matter = inject(MatterStore);

  protected readonly custodians = this.matter.custodians;

  protected readonly selected = computed<readonly string[]>(() => {
    if (!this.store || !this.slot) return [];
    const v = this.store.values()[this.slot];
    return Array.isArray(v) ? (v as readonly string[]) : [];
  });

  protected isSelected(id: string): boolean {
    return this.selected().includes(id);
  }

  protected toggle(id: string): void {
    if (!this.store || !this.slot) return;
    const cur = this.selected();
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    this.store.write(this.slot, next);
  }
}

// ── Step 3: Date range picker ───────────────────────────────────────────────

interface DateRange {
  readonly from?: string;
  readonly to?: string;
}

@Component({
  selector: 'app-place-hold-dates',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <p class="hint">
      Optional. Limits the hold scope to documents authored in this window.
    </p>
    <div class="grid">
      <label>From
        <input type="date"
               [ngModel]="value().from ?? ''"
               (ngModelChange)="patch({ from: $event })"
               name="from" />
      </label>
      <label>To
        <input type="date"
               [ngModel]="value().to ?? ''"
               (ngModelChange)="patch({ to: $event })"
               name="to" />
      </label>
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 0.4rem; }
    .hint { margin: 0; color: #6b7280; font-size: 0.8rem; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
    label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.85rem; color: #374151; }
    input { padding: 0.4rem 0.5rem; border: 1px solid #d1d5db; border-radius: 0.3rem; font: inherit; }
  `,
})
export class PlaceHoldDatesComponent {
  private readonly slot = inject(COMPOSITION_SLOT, { optional: true });
  private readonly store = inject(CompositionStore, { optional: true });

  protected readonly value = computed<DateRange>(() => {
    if (!this.store || !this.slot) return {};
    const v = this.store.values()[this.slot];
    return (v as DateRange | undefined) ?? {};
  });

  protected patch(part: Partial<DateRange>): void {
    if (!this.store || !this.slot) return;
    const next: DateRange = { ...this.value(), ...part };
    // Treat empty strings as unset so isDirty works as expected.
    if (!next.from) delete (next as { from?: string }).from;
    if (!next.to) delete (next as { to?: string }).to;
    if (Object.keys(next).length === 0) {
      this.store.drop(this.slot);
    } else {
      this.store.write(this.slot, next);
    }
  }
}

// ── Step 4: Hold notice preview ─────────────────────────────────────────────

@Component({
  selector: 'app-place-hold-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="hint">Review the hold before submitting. Click Submit on the wizard to send.</p>
    <article class="notice">
      <header><strong>LEGAL HOLD NOTICE</strong></header>
      <dl>
        <dt>Keywords</dt>
        <dd>
          @if (keywords().length > 0) {
            @for (kw of keywords(); track kw) { <span class="chip">{{ kw }}</span> }
          } @else {
            <em class="empty">none specified</em>
          }
        </dd>
        <dt>Custodians</dt>
        <dd>
          @if (custodians().length > 0) {
            <ul>
              @for (c of custodians(); track c) { <li>{{ c }}</li> }
            </ul>
          } @else {
            <em class="empty">none selected</em>
          }
        </dd>
        <dt>Date range</dt>
        <dd>
          @if (range().from || range().to) {
            {{ range().from ?? '—' }} → {{ range().to ?? '—' }}
          } @else {
            <em class="empty">unbounded</em>
          }
        </dd>
      </dl>
    </article>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 0.4rem; }
    .hint { margin: 0; color: #6b7280; font-size: 0.8rem; }
    .notice { border: 1px solid #d1d5db; border-radius: 0.4rem; padding: 0.7rem 0.9rem; background: #fafafa; }
    header strong { font-size: 0.78rem; letter-spacing: 0.06em; color: #374151; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.3rem 0.7rem; margin: 0.4rem 0 0; }
    dt { font-size: 0.8rem; font-weight: 500; color: #6b7280; padding-top: 0.15rem; }
    dd { margin: 0; font-size: 0.85rem; color: #111827; }
    .chip { display: inline-block; padding: 0.1rem 0.5rem; margin: 0 0.25rem 0.2rem 0; border-radius: 999px; background: #e0e7ff; color: #3730a3; font-size: 0.78rem; }
    ul { margin: 0; padding-left: 1.1rem; }
    .empty { color: #9ca3af; font-style: italic; }
  `,
})
export class PlaceHoldPreviewComponent {
  private readonly store = inject(CompositionStore, { optional: true });
  private readonly matter = inject(MatterStore);

  protected readonly keywords = computed<readonly string[]>(() => {
    const v = this.store?.values()['scope'];
    return Array.isArray(v) ? (v as readonly string[]) : [];
  });

  protected readonly custodians = computed<readonly string[]>(() => {
    const ids = (this.store?.values()['custodians'] as readonly string[] | undefined) ?? [];
    const all = this.matter.custodians();
    return ids.map((id) => {
      const c = all.find((x) => x.id === id);
      return c ? `${c.name} (${c.department})` : id;
    });
  });

  protected readonly range = computed<DateRange>(() => {
    const v = this.store?.values()['date-range'];
    return (v as DateRange | undefined) ?? {};
  });
}

// ── Step 2.alt: Matter-setup redirect (for AC-F3-2 conditional next) ────────

@Component({
  selector: 'app-place-hold-matter-setup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="notice" role="alert">
      <header>
        <strong>This matter has no custodians yet.</strong>
      </header>
      <p>
        A legal hold needs at least one custodian to cover. Open the
        Custodians page (or ask the agent to onboard one) and try again.
      </p>
    </article>
  `,
  styles: `
    :host { display: block; }
    .notice { padding: 0.7rem 0.9rem; background: #fef3c7; color: #78350f; border: 1px solid #fde68a; border-radius: 0.4rem; }
    header strong { font-size: 0.9rem; }
    p { margin: 0.4rem 0 0; font-size: 0.85rem; line-height: 1.4; }
  `,
})
export class PlaceHoldMatterSetupComponent {}
