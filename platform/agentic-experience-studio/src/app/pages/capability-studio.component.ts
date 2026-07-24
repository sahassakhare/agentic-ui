import { Component, inject, input, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CapabilityCatalogService, type Capability } from '../services/capability-catalog.service';

/** A field in a capability authoring form. */
export interface StudioField {
  readonly key: string;
  readonly label: string;
  readonly type: 'text' | 'textarea' | 'number' | 'checkbox';
  readonly required?: boolean;
  readonly placeholder?: string;
}

/** Route-data config that parameterizes the generic capability studio. */
export interface StudioConfig {
  readonly kind: string;        // 'prompt' | 'navigation' | …
  readonly title: string;       // "Prompt Studio"
  readonly noun: string;        // "prompt"
  readonly bodyFields: readonly StudioField[]; // fields stored in body
}

/**
 * Generic authoring studio for a capability kind (AEP Seam B/E). Lists existing
 * capabilities of `config.kind` and creates new ones via the catalog
 * `/capabilities` API. Parameterized by route `data.config` so one component
 * powers the Prompt and Navigation studios (and any future kind). The runtime
 * registries mirror these kinds — the studio only authors the metadata.
 */
@Component({
  selector: 'aes-capability-studio',
  imports: [FormsModule],
  template: `
    <h1>{{ cfg().title }}</h1>

    <details class="create" [open]="createOpen()">
      <summary (click)="toggleCreate($event)">+ New {{ cfg().noun }}</summary>
      <div class="form">
        <label>Name (id)
          <input [(ngModel)]="values['name']" [placeholder]="cfg().noun + 'Name'" />
        </label>
        @for (f of cfg().bodyFields; track f.key) {
          <label [class.wide]="f.type === 'textarea'">
            {{ f.label }}{{ f.required ? ' *' : '' }}
            @switch (f.type) {
              @case ('textarea') { <textarea rows="3" [(ngModel)]="values[f.key]" [placeholder]="f.placeholder ?? ''"></textarea> }
              @case ('checkbox') { <input type="checkbox" [(ngModel)]="values[f.key]" /> }
              @case ('number') { <input type="number" [(ngModel)]="values[f.key]" [placeholder]="f.placeholder ?? ''" /> }
              @default { <input [(ngModel)]="values[f.key]" [placeholder]="f.placeholder ?? ''" /> }
            }
          </label>
        }
        <button [disabled]="!canCreate() || saving()" (click)="create()">
          {{ saving() ? 'Creating…' : 'Create' }}
        </button>
      </div>
    </details>

    @if (error()) { <p class="error">{{ error() }}</p> }
    @if (loading()) { <p>Loading…</p> }
    @if (!loading() && items().length === 0) { <p class="muted">No {{ cfg().noun }}s yet.</p> }

    <ul class="list">
      @for (c of items(); track c.id) {
        <li>
          <strong>{{ c.name }}</strong>
          <span class="summary">{{ summarize(c) }}</span>
          <button class="del" (click)="remove(c)">Delete</button>
        </li>
      }
    </ul>
  `,
  styles: [`
    label { display: flex; flex-direction: column; font-size: .75rem; gap: .25rem; }
    input, textarea { padding: .35rem .5rem; font: inherit; }
    input[type=checkbox] { align-self: start; width: 1rem; height: 1rem; }
    .create { margin-bottom: 1rem; }
    .create summary { cursor: pointer; padding: .4rem 0; font-weight: 600; }
    .create .form { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; padding: .5rem 0; }
    .create .form .wide { grid-column: 1 / -1; }
    .create button { grid-column: 1 / -1; justify-self: start; padding: .4rem 1rem; }
    .list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: .5rem; }
    .list li { display: flex; gap: .75rem; align-items: center; padding: .6rem .75rem;
      border: 1px solid color-mix(in srgb, currentColor 12%, transparent); border-radius: 8px; }
    .summary { opacity: .6; font-size: .85rem; }
    .del { margin-left: auto; padding: .2rem .6rem; font-size: .8rem; }
    .error { color: crimson; } .muted { opacity: .6; }
  `],
})
export class CapabilityStudioComponent {
  private readonly catalog = inject(CapabilityCatalogService);

  /** Bound from route `data.config` via withComponentInputBinding(). */
  readonly config = input.required<StudioConfig>();
  cfg = () => this.config();

  readonly items = signal<readonly Capability[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly createOpen = signal(false);

  values: Record<string, unknown> = {};

  constructor() {
    // Reload whenever the kind changes (navigating Prompt → Navigation).
    effect(() => { this.config(); this.refresh(); });
  }

  canCreate(): boolean {
    if (!String(this.values['name'] ?? '').trim()) return false;
    return this.cfg().bodyFields.filter((f) => f.required).every((f) => String(this.values[f.key] ?? '').trim() !== '');
  }

  toggleCreate(ev: Event): void { ev.preventDefault(); this.createOpen.update((v) => !v); }

  refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.catalog.listByKind(this.cfg().kind).subscribe({
      next: (res) => { this.items.set(res.items); this.loading.set(false); },
      error: (err) => { this.error.set(msg(err)); this.loading.set(false); },
    });
  }

  create(): void {
    if (!this.canCreate()) return;
    this.saving.set(true);
    this.error.set(null);
    const name = String(this.values['name']).trim();
    const body: Record<string, unknown> = {};
    for (const f of this.cfg().bodyFields) {
      const raw = this.values[f.key];
      if (raw === undefined || raw === '' || raw === null) continue;
      body[f.key] = f.type === 'number' ? Number(raw) : f.type === 'checkbox' ? Boolean(raw) : raw;
    }
    this.catalog.create({ kind: this.cfg().kind, name, body }).subscribe({
      next: (created) => {
        this.saving.set(false);
        this.createOpen.set(false);
        this.values = {};
        this.items.update((cur) => [created, ...cur]);
      },
      error: (err) => { this.error.set(msg(err)); this.saving.set(false); },
    });
  }

  remove(c: Capability): void {
    this.catalog.remove(c.id).subscribe({
      next: () => this.items.update((cur) => cur.filter((x) => x.id !== c.id)),
      error: (err) => this.error.set(msg(err)),
    });
  }

  summarize(c: Capability): string {
    const first = this.cfg().bodyFields[0]?.key;
    const v = first ? c.body[first] : undefined;
    return v == null ? '' : String(v).slice(0, 80);
  }
}

function msg(err: unknown): string {
  const e = err as { status?: number; error?: { message?: string } };
  if (e?.status === 401) return 'Session expired — please sign in again.';
  if (e?.status === 409) return e.error?.message ?? 'Name already exists.';
  return e?.error?.message ?? 'Request failed.';
}
