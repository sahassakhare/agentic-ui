import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../services/auth.service';
import { ExperienceCatalogService, type Experience } from '../services/experience-catalog.service';

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
    <section class="conn">
      <label>Tenant <input [(ngModel)]="tenant" placeholder="test-tenant" /></label>
      <label>Token <input [(ngModel)]="token" type="password" placeholder="JWT" /></label>
      <button (click)="connect()">Connect</button>
    </section>

    <h1>Experiences</h1>

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
    .conn { display: flex; gap: 1rem; align-items: end; flex-wrap: wrap; margin-bottom: 1rem;
      padding: .75rem; border: 1px solid color-mix(in srgb, currentColor 15%, transparent); border-radius: 8px; }
    label { display: flex; flex-direction: column; font-size: .75rem; gap: .25rem; }
    input { padding: .35rem .5rem; }
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
  private readonly auth = inject(AuthService);

  readonly items = signal<readonly Experience[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  tenant = this.auth.tenant() ?? '';
  token = '';

  constructor() {
    if (this.auth.tenant()) this.refresh();
  }

  connect(): void {
    if (this.tenant) this.auth.setTenant(this.tenant.trim());
    if (this.token) this.auth.setToken(this.token.trim());
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
  if (e?.status === 401) return 'Unauthorized — set a valid token above.';
  return e?.error?.message ?? 'Request failed. Check the catalog URL and tenant.';
}
