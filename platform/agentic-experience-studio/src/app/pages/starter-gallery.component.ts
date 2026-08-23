import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { CapabilityCatalogService } from '../services/capability-catalog.service';
import { ToastService } from '../services/toast.service';
import { STARTER_TEMPLATES, STARTER_ROUTE, type StarterTemplate } from '../starters';

interface StarterGroup { readonly kind: string; readonly label: string; readonly items: readonly StarterTemplate[]; }

/**
 * Starter gallery — solves the blank-canvas problem. Pick a governed starter and
 * the Studio clones its body into a new draft capability, then drops you into the
 * matching designer to refine it. Starters are self-contained (forms, pages) so a
 * clone is always valid with no unmet dependencies.
 */
@Component({
  selector: 'aes-starter-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
  template: `
    <div class="page">
      <div class="page-header" style="margin-top:var(--s4)">
        <div class="titles">
          <span class="eyebrow">Start from a template</span>
          <h1>Templates</h1>
          <p class="subtitle">Clone a governed starter into a new draft, then refine it in the designer — no blank canvas.</p>
        </div>
      </div>

      @for (g of groups(); track g.kind) {
        <section style="margin-top:var(--s5)">
          <div class="eyebrow" style="margin-bottom:var(--s3)">{{ g.label }}</div>
          <div class="grid">
            @for (t of g.items; track t.id) {
              <article class="card card-pad tpl">
                <div class="tpl-head">
                  <span class="glyph" aria-hidden="true"><mat-icon>{{ t.icon }}</mat-icon></span>
                  <h3>{{ t.title }}</h3>
                </div>
                <p class="desc">{{ t.description }}</p>
                <button class="btn btn-primary" type="button" (click)="use(t)" [disabled]="busy() === t.id">
                  @if (busy() === t.id) { <span class="spinner" aria-hidden="true"></span> Creating… }
                  @else { Use this template }
                </button>
              </article>
            }
          </div>
        </section>
      }
    </div>
  `,
  styles: [`
    .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:var(--s4); }
    .tpl { display:flex; flex-direction:column; gap:var(--s2); }
    .tpl-head { display:flex; align-items:center; gap:var(--s3); }
    .tpl-head .glyph { width:34px; height:34px; display:grid; place-items:center; border-radius:var(--r-sm);
      background:var(--brand-soft); color:var(--brand); font-size:18px; }
    .tpl-head .glyph mat-icon { font-size:20px; width:20px; height:20px; }
    .tpl-head h3 { margin:0; font-size:var(--fs-md); }
    .tpl .desc { margin:0; color:var(--text-muted); font-size:var(--fs-sm); line-height:1.5; flex:1; }
    .tpl .btn { align-self:flex-start; margin-top:var(--s2); }
  `],
})
export class StarterGalleryComponent {
  private readonly catalog = inject(CapabilityCatalogService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  /** Which template is currently being created (its id), for the button's busy state. */
  protected readonly busy = signal<string | null>(null);

  protected readonly groups = computed<StarterGroup[]>(() => {
    const byKind = new Map<string, StarterTemplate[]>();
    for (const t of STARTER_TEMPLATES) {
      const list = byKind.get(t.kind) ?? [];
      list.push(t);
      byKind.set(t.kind, list);
    }
    const LABELS: Record<string, string> = { form: 'Forms', page: 'Pages' };
    return [...byKind.entries()].map(([kind, items]) => ({ kind, label: LABELS[kind] ?? kind, items }));
  });

  protected use(t: StarterTemplate): void {
    if (this.busy()) return;
    this.busy.set(t.id);
    const name = `${t.nameBase}-${Date.now().toString(36).slice(-4)}`;
    this.catalog.create({ kind: t.kind, name, body: { ...t.body }, tags: ['starter', t.id] }).subscribe({
      next: (created) => {
        this.busy.set(null);
        this.toast.success('Draft created', `“${created.name}” from the ${t.title} template.`);
        void this.router.navigate(['/', STARTER_ROUTE[t.kind], created.id, 'design']);
      },
      error: (err: unknown) => {
        this.busy.set(null);
        this.toast.error('Could not create', (err as { message?: string })?.message ?? 'Please try again.');
      },
    });
  }
}
