import { ChangeDetectionStrategy, Component, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { CapabilityCatalogService } from './services/capability-catalog.service';
import type { CapabilityRequirement } from './services/experience-catalog.service';

/** One editable requirement row: a kind + a chosen registry entry of that kind. */
interface RequirementRow { kind: string; selector: string; optional: boolean; }
/** Capability kinds a requirement can target (mirror the catalog CAPABILITY_KINDS). */
export const REQ_KINDS: readonly string[] = [
  'component', 'form', 'workflow', 'tool', 'prompt', 'skill', 'knowledge', 'memory', 'navigation', 'datasource',
];

/**
 * Select-and-define requirements builder (AEP Seam E authoring). Each row is a
 * KIND dropdown plus a dependent ENTRY dropdown whose options are the tenant's
 * registry capabilities of that kind — no free text. Shared by the create form
 * (experiences list) and the edit form (experience detail) so they stay
 * identical. Emits the catalog `CapabilityRequirement[]` on every change.
 */
@Component({
  selector: 'aes-requirements-builder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatSelectModule, MatCheckboxModule],
  template: `
    <div class="reqs">
      @for (r of rows; track $index) {
        <div class="reqrow">
          <span class="seq" [attr.title]="'Precedence ' + ($index + 1)">{{ $index + 1 }}</span>
          <div class="move">
            <button type="button" class="mv" (click)="moveUp($index)" [disabled]="$index === 0" aria-label="Move earlier">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="m6 15 6-6 6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button type="button" class="mv" (click)="moveDown($index)" [disabled]="$index === rows.length - 1" aria-label="Move later">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af rk">
            <mat-label>Kind</mat-label>
            <mat-select [ngModel]="r.kind" (ngModelChange)="setKind($index, $event)" [name]="'rk'+$index">
              @for (k of kinds; track k) { <mat-option [value]="k">{{ k }}</mat-option> }
            </mat-select>
          </mat-form-field>
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af rn">
            <mat-label>{{ capsFor(r.kind).length ? r.kind : 'no ' + r.kind }}</mat-label>
            <mat-select [ngModel]="r.selector" (ngModelChange)="setSelector($index, $event)" [name]="'rn'+$index">
              @for (n of optionsFor(r); track n) {
                <mat-option [value]="n">{{ n }}{{ isOrphan(r, n) ? ' — not in registry' : '' }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
          <mat-checkbox [ngModel]="r.optional" (ngModelChange)="setOptional($index, $event)" [name]="'ro'+$index">optional</mat-checkbox>
          <button type="button" class="rrm" (click)="removeReq($index)" aria-label="Remove requirement">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
      }
    </div>
    <button type="button" matButton class="btn-add" (click)="addReq()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      Add requirement
    </button>
    <span class="help">Each requirement is a registry entry of the chosen kind. Order (top → bottom) sets precedence — reorder with the arrows. These become the experience's dependency graph.</span>
  `,
  styles: [`
    :host { display: block; }
    .reqs { display: flex; flex-direction: column; gap: var(--s2); }
    .reqrow { display: grid; grid-template-columns: 22px 26px 150px 1fr auto auto; gap: var(--s2); align-items: center; }
    .reqrow .seq { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text-faint); text-align: center; font-variant-numeric: tabular-nums; }
    .reqrow .rk { text-transform: capitalize; }
    .reqrow .opt { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--text-muted); white-space: nowrap; }
    .move { display: inline-flex; flex-direction: column; gap: 1px; }
    .move .mv { display: grid; place-items: center; width: 24px; height: 15px; border: 1px solid var(--border); background: var(--surface);
      color: var(--text-muted); cursor: pointer; padding: 0; }
    .move .mv:first-child { border-radius: var(--r-sm) var(--r-sm) 0 0; border-bottom: 0; }
    .move .mv:last-child { border-radius: 0 0 var(--r-sm) var(--r-sm); }
    .move .mv:not(:disabled):hover { border-color: var(--brand); color: var(--brand); }
    .move .mv:disabled { opacity: .35; cursor: default; }
    .reqrow .rrm { display: grid; place-items: center; width: 30px; height: 30px; border: 1px solid var(--border); border-radius: var(--r-sm);
      background: var(--surface); color: var(--text-muted); cursor: pointer; }
    .reqrow .rrm:hover { border-color: var(--danger); color: var(--danger); }
    .btn-add { margin-top: var(--s2); font-size: var(--fs-sm); padding: .35rem .7rem; }
    @media (max-width: 560px) {
      .reqrow {
        grid-template-columns: 22px 26px 1fr auto;
        grid-template-areas: "seq move kind rm" "reg reg reg opt";
        row-gap: var(--s2);
      }
      .reqrow .seq { grid-area: seq; }
      .reqrow .move { grid-area: move; }
      .reqrow .rk { grid-area: kind; }
      .reqrow .rn { grid-area: reg; }
      .reqrow .opt { grid-area: opt; justify-self: end; }
      .reqrow .rrm { grid-area: rm; }
    }
  `],
})
export class RequirementsBuilderComponent {
  private readonly caps = inject(CapabilityCatalogService);

  /** Initial requirements to seed the rows from (read once on first render). */
  readonly initial = input<readonly CapabilityRequirement[]>([]);
  /** Emitted whenever the requirements change. */
  readonly requirementsChange = output<CapabilityRequirement[]>();

  readonly kinds = REQ_KINDS;
  rows: RequirementRow[] = [];
  /** Capability names per kind, for the dependent "registry entry" dropdown. */
  private readonly capsByKind = signal<Record<string, readonly string[]>>({});
  capsFor(kind: string): readonly string[] { return this.capsByKind()[kind] ?? []; }
  /** Registry options for a row, PLUS its current value if that isn't registered
   *  (so editing an experience whose capability isn't in the catalog never drops it). */
  optionsFor(r: RequirementRow): string[] {
    const base = [...this.capsFor(r.kind)];
    if (r.selector && !base.includes(r.selector)) base.unshift(r.selector);
    return base;
  }
  isOrphan(r: RequirementRow, name: string): boolean {
    return name === r.selector && !this.capsFor(r.kind).includes(name);
  }

  private seeded = false;

  constructor() {
    for (const kind of this.kinds) {
      this.caps.listByKind(kind).subscribe({
        next: (res) => this.capsByKind.update((m) => ({ ...m, [kind]: res.items.map((c) => c.name) })),
        error: () => { /* dependent dropdown is best-effort; empty kind → disabled */ },
      });
    }
    // Seed rows once from `initial` (each open mounts a fresh instance).
    effect(() => {
      const init = this.initial();
      if (this.seeded) return;
      this.seeded = true;
      this.rows = init.length
        ? init.map((r) => ({ kind: r.kind, selector: r.name ?? (r.tag ? `#${r.tag}` : ''), optional: !!r.optional }))
        : [{ kind: 'workflow', selector: '', optional: false }];
    });
  }

  setKind(i: number, kind: string): void {
    // Changing the kind resets the entry — the registry options for it differ.
    this.rows = this.rows.map((r, idx) => (idx === i ? { ...r, kind, selector: '' } : r));
    this.emit();
  }
  setSelector(i: number, selector: string): void {
    this.rows = this.rows.map((r, idx) => (idx === i ? { ...r, selector } : r));
    this.emit();
  }
  setOptional(i: number, optional: boolean): void {
    this.rows = this.rows.map((r, idx) => (idx === i ? { ...r, optional } : r));
    this.emit();
  }
  addReq(): void { this.rows = [...this.rows, { kind: 'workflow', selector: '', optional: false }]; this.emit(); }
  removeReq(i: number): void { this.rows = this.rows.filter((_, idx) => idx !== i); this.emit(); }
  /** Reorder precedence — the requires[] array order is preserved on save. */
  moveUp(i: number): void { if (i > 0) this.swap(i, i - 1); }
  moveDown(i: number): void { if (i < this.rows.length - 1) this.swap(i, i + 1); }
  private swap(a: number, b: number): void {
    const next = [...this.rows];
    [next[a], next[b]] = [next[b]!, next[a]!];
    this.rows = next;
    this.emit();
  }

  /** Build catalog requirements from the rows; `#tag` → tag, else name. */
  private emit(): void {
    const out: CapabilityRequirement[] = this.rows
      .filter((r) => r.selector.trim())
      .map((r) => {
        const sel = r.selector.trim();
        return sel.startsWith('#')
          ? { kind: r.kind, tag: sel.slice(1), ...(r.optional ? { optional: true } : {}) }
          : { kind: r.kind, name: sel, ...(r.optional ? { optional: true } : {}) };
      });
    this.requirementsChange.emit(out);
  }
}
