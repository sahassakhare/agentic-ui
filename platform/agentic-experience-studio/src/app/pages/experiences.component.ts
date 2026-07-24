import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ExperienceCatalogService, type Experience } from '../services/experience-catalog.service';
import { parseRequirementLines } from '../experience-form';

/**
 * Experience list — the studio's landing surface (AEP Seam E). Lists the
 * tenant's experiences with their approval state, and a minimal connection
 * bar to set the tenant + token (the studio talks to the same catalog server
 * as the ops console, independently).
 */
@Component({
  selector: 'aes-experiences',
  imports: [RouterLink, FormsModule],
  template: `
    <h1>Experiences</h1>

    <details class="create" [open]="createOpen()">
      <summary (click)="toggleCreate($event)">+ New experience</summary>
      <div class="form">
        <label>Name (id) <input [(ngModel)]="newName" placeholder="legalIntake" /></label>
        <label>Title <input [(ngModel)]="newTitle" placeholder="Legal Intake" /></label>
        <label>Goal <input [(ngModel)]="newGoal" placeholder="Create Legal Matter" /></label>
        <label class="wide">Requirements — one per line: <code>kind selector [optional]</code>
          <textarea rows="4" [(ngModel)]="newRequires"
            placeholder="form customerSearch&#10;tool conflictCheck&#10;component #result-card&#10;tool aiSummary optional"></textarea>
        </label>
        <button [disabled]="!canCreate() || saving()" (click)="create()">
          {{ saving() ? 'Creating…' : 'Create (draft)' }}
        </button>
      </div>
    </details>

    @if (error()) { <p class="error">{{ error() }}</p> }
    @if (loading()) { <p>Loading…</p> }

    @if (!loading() && items().length === 0) {
      <p class="muted">No experiences yet for this tenant.</p>
    }

    <ul class="list">
      @for (e of items(); track e.id) {
        <li>
          <a [routerLink]="['/experiences', e.id]"><strong>{{ e.title }}</strong></a>
          <code>{{ e.name }}</code>
          <span class="badge" [class]="e.approvalState">{{ e.approvalState }}</span>
          <span class="goal">{{ e.goal }}</span>
        </li>
      }
    </ul>
  `,
  styles: [`
    label { display: flex; flex-direction: column; font-size: .75rem; gap: .25rem; }
    input, textarea { padding: .35rem .5rem; font: inherit; }
    .create { margin-bottom: 1rem; }
    .create summary { cursor: pointer; padding: .4rem 0; font-weight: 600; }
    .create .form { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; padding: .5rem 0; }
    .create .form .wide { grid-column: 1 / -1; }
    .create button { grid-column: 1 / -1; justify-self: start; padding: .4rem 1rem; }
    .list { list-style: none; padding: 0; display: flex; flex-direction: column; gap: .5rem; }
    .list li { display: flex; gap: .75rem; align-items: center; padding: .6rem .75rem;
      border: 1px solid color-mix(in srgb, currentColor 12%, transparent); border-radius: 8px; }
    code { opacity: .7; font-size: .8rem; }
    .goal { opacity: .6; margin-left: auto; font-size: .85rem; }
    .badge { font-size: .7rem; text-transform: uppercase; padding: .1rem .4rem; border-radius: 4px;
      background: color-mix(in srgb, currentColor 12%, transparent); }
    .badge.approved { background: color-mix(in srgb, green 30%, transparent); }
    .badge.review { background: color-mix(in srgb, orange 30%, transparent); }
    .error { color: crimson; }
    .muted { opacity: .6; }
  `],
})
export class ExperiencesComponent {
  private readonly catalog = inject(ExperienceCatalogService);

  readonly items = signal<readonly Experience[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  // Create form state.
  readonly createOpen = signal(false);
  readonly saving = signal(false);
  newName = '';
  newTitle = '';
  newGoal = '';
  newRequires = '';

  canCreate(): boolean {
    return this.newName.trim() !== '' && this.newTitle.trim() !== '' && this.newGoal.trim() !== '';
  }

  toggleCreate(ev: Event): void {
    ev.preventDefault();
    this.createOpen.update((v) => !v);
  }

  create(): void {
    if (!this.canCreate()) return;
    this.saving.set(true);
    this.error.set(null);
    this.catalog
      .create({
        name: this.newName.trim(),
        title: this.newTitle.trim(),
        goal: this.newGoal.trim(),
        body: { requires: parseRequirementLines(this.newRequires) },
      })
      .subscribe({
        next: (created) => {
          this.saving.set(false);
          this.createOpen.set(false);
          this.newName = this.newTitle = this.newGoal = this.newRequires = '';
          this.items.update((cur) => [created, ...cur]);
        },
        error: (err) => { this.error.set(describe(err)); this.saving.set(false); },
      });
  }

  constructor() {
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.error.set(null);
    this.catalog.list().subscribe({
      next: (res) => { this.items.set(res.items); this.loading.set(false); },
      error: (err) => { this.error.set(describe(err)); this.loading.set(false); },
    });
  }
}

function describe(err: unknown): string {
  const e = err as { status?: number; error?: { message?: string } };
  if (e?.status === 401) return 'Session expired — please sign in again.';
  return e?.error?.message ?? 'Request failed. Check the catalog URL.';
}
