/**
 * The Experience Hub login gate. Shown until the user is authenticated.
 *
 *  - **disabled mode** — pick a persona + the permissions you hold (these drive
 *    the ExperiencePlanner access gate for every experience), then enter.
 *  - **oidc mode** — paste a JWT from the identity provider.
 *
 * Persona / permission options are discovered from the catalog-loaded
 * experiences, so the gate reflects whatever product owners authored.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ExperienceRegistry } from '@infra-tools/agentic-ui';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { CatalogExperienceSource } from '../catalog/catalog-experience-source';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="wrap">
      <section class="card">
        <div class="brand">
          <span class="mark"><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 12 3 7m9 5 9-5m-9 5v10" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" opacity=".55"/></svg></span>
          <div><strong>Experience Hub</strong><div class="sub">Sign in to open your applications</div></div>
        </div>

        @if (mode === 'disabled') {
          <label class="lbl" for="persona">Persona</label>
          <select id="persona" class="input" [(ngModel)]="persona">
            @for (p of personaOptions(); track p) { <option [value]="p">{{ p }}</option> }
          </select>

          @if (permissionOptions().length) {
            <label class="lbl">Permissions you hold <span class="muted">— defines your access</span></label>
            <div class="multibox">
              @for (perm of permissionOptions(); track perm) {
                <label class="chk" [class.on]="has(perm)">
                  <input type="checkbox" [checked]="has(perm)" (change)="toggle(perm)" /> {{ perm }}
                </label>
              }
            </div>
          } @else {
            <p class="muted sm">No permission-gated experiences loaded yet.</p>
          }

          <button class="btn" (click)="enterDisabled()">Enter the Hub →</button>
          <p class="foot">Trusted-network mode · no password. Matches the catalog's <code>AUTH_MODE=disabled</code>.</p>
        } @else {
          <label class="lbl" for="jwt">Access token (JWT)</label>
          <textarea id="jwt" class="input mono" rows="4" [(ngModel)]="jwt" placeholder="paste your JWT"></textarea>
          @if (error()) { <p class="err">{{ error() }}</p> }
          <button class="btn" (click)="enterOidc()">Sign in →</button>
          <p class="foot">OIDC mode · token is validated by the catalog.</p>
        }
      </section>
    </div>
  `,
  styles: [`
    .wrap { min-height:100dvh; display:grid; place-items:center; padding:24px;
      background:radial-gradient(1200px 600px at 50% -10%, rgba(103,80,164,.14), transparent); }
    .card { width:min(420px,100%); background:var(--surface,#fff); border:1px solid rgba(120,120,140,.18);
      border-radius:18px; padding:26px; box-shadow:0 12px 40px rgba(0,0,0,.10); }
    .brand { display:flex; align-items:center; gap:12px; margin-bottom:18px; }
    .brand strong { font-size:17px; } .sub { font-size:12.5px; opacity:.6; }
    .mark { display:grid; place-items:center; width:38px; height:38px; border-radius:11px;
      background:rgba(103,80,164,.12); color:#6750a4; }
    .lbl { display:block; font-size:12px; font-weight:600; margin:14px 0 6px; opacity:.8; }
    .muted { opacity:.55; font-weight:400; } .muted.sm, .sm { font-size:12.5px; }
    .input { width:100%; padding:11px 12px; border:1px solid rgba(120,120,140,.3); border-radius:9px;
      background:transparent; color:inherit; font:inherit; }
    .input.mono, .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; }
    .multibox { display:flex; flex-wrap:wrap; gap:8px; }
    .chk { display:inline-flex; align-items:center; gap:7px; font-size:13px; padding:7px 11px; cursor:pointer;
      border:1px solid rgba(120,120,140,.3); border-radius:20px; }
    .chk.on { background:rgba(103,80,164,.14); border-color:#6750a4; color:#6750a4; }
    .chk input { accent-color:#6750a4; }
    .btn { margin-top:18px; width:100%; padding:12px; border:none; border-radius:10px; cursor:pointer;
      background:#6750a4; color:#fff; font:inherit; font-weight:600; }
    .foot { margin:14px 0 0; font-size:11.5px; opacity:.55; text-align:center; }
    .foot code { font-size:11px; } .err { color:#c0392b; font-size:12.5px; margin:10px 0 0; }
  `],
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly experiences = inject(ExperienceRegistry);
  private readonly catalog = inject(CatalogExperienceSource);

  protected readonly mode = environment.authMode;
  protected readonly persona = signal('end-user');
  protected readonly held = signal<string[]>([]);
  protected readonly jwt = signal('');
  protected readonly error = signal<string | null>(null);

  // `catalog.count()` makes these recompute after the catalog hydrates.
  protected readonly personaOptions = computed(() => {
    this.catalog.count();
    const set = new Set<string>(['end-user', 'admin']);
    for (const e of this.experiences.list()) for (const p of ((e as { personas?: string[] }).personas ?? [])) set.add(p);
    return [...set];
  });
  protected readonly permissionOptions = computed(() => {
    this.catalog.count();
    const set = new Set<string>();
    for (const e of this.experiences.list()) for (const p of ((e as { requiredPermissions?: string[] }).requiredPermissions ?? [])) set.add(p);
    return [...set];
  });

  protected has(p: string): boolean { return this.held().includes(p); }
  protected toggle(p: string): void {
    this.held.update((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  }

  protected enterDisabled(): void { this.auth.signInDisabled(this.persona(), this.held()); }
  protected enterOidc(): void {
    if (!this.auth.signInOidc(this.jwt().trim())) this.error.set('That does not look like a valid JWT.');
  }
}
