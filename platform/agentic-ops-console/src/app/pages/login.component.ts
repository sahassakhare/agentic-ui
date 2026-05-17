import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService, decodePrincipal } from '../services/auth.service';

@Component({
  selector: 'ops-login',
  imports: [FormsModule],
  template: `
    <div class="login">
      <div class="card">
        @if (authMode === 'disabled') {
          <h1>Pick a tenant</h1>
          <div class="warn">
            ⚠️ This catalog runs with <code>AUTH_MODE=disabled</code>.
            Anyone who reaches it has full read+write across every
            tenant. Demo / trusted-network only — see ADR-022.
          </div>
          <p class="dim">
            Type the tenant id you want to view. The console
            synthesises a platform-admin principal scoped to that
            tenant. Switch tenants any time from the sidebar.
          </p>
          <input
            [(ngModel)]="tenantInput"
            placeholder="acme"
            class="mono"
            (keyup.enter)="submit()"
          />
        } @else {
          <h1>Sign in</h1>
          <p class="dim">
            Paste a JWT issued by your OIDC provider. The console runs
            every request as you — your tenant + roles come from the
            token's claims.
          </p>
          <textarea
            [(ngModel)]="token"
            rows="6"
            placeholder="eyJhbGciOiJSUzI1NiIs..."
            class="mono"
          ></textarea>
        }
        @if (error()) {
          <div class="error">{{ error() }}</div>
        }
        <button class="btn primary" type="button" (click)="submit()">
          {{ authMode === 'disabled' ? 'Open tenant' : 'Sign in' }}
        </button>
        @if (authMode === 'oidc') {
          <p class="dim small">
            OIDC redirect flow lands in C6.1; v0 trades convenience for
            transparency — operators paste exactly what they want the
            catalog to see.
          </p>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .login {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .card {
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 32px;
      max-width: 540px;
      width: 100%;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    h1 { margin: 0; }
    .dim { color: var(--fg-muted); }
    textarea, input {
      background: var(--bg);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      width: 100%;
      resize: vertical;
    }
    textarea:focus, input:focus { outline: none; border-color: var(--accent); }
    .small { font-size: 12px; }
    .warn {
      background: rgba(210, 153, 34, 0.08);
      border: 1px solid var(--warn);
      color: var(--warn);
      border-radius: 6px;
      padding: 12px;
      font-size: 13px;
    }
    code { font-family: var(--mono); background: var(--bg-elev-2); padding: 1px 4px; border-radius: 4px; }
  `],
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly authMode = this.auth.authMode;
  readonly token = signal('');
  readonly tenantInput = signal('');
  readonly error = signal<string | null>(null);

  submit(): void {
    if (this.authMode === 'disabled') {
      const t = this.tenantInput().trim();
      if (!t) {
        this.error.set('Tenant id is required');
        return;
      }
      // Match the catalog's tenant-id regex (ADR-020 D2).
      if (!/^[a-zA-Z0-9_.-]+$/.test(t)) {
        this.error.set('Tenant id must match [a-zA-Z0-9_.-]+');
        return;
      }
      this.error.set(null);
      this.auth.setTenantId(t);
      void this.router.navigate(['/']);
      return;
    }

    const token = this.token().trim();
    if (!token) {
      this.error.set('Token is required');
      return;
    }
    const p = decodePrincipal(token);
    if (!p) {
      this.error.set('Token is not a well-formed JWT or is missing the tenant_id claim');
      return;
    }
    if (p.expiresAt && p.expiresAt < Date.now()) {
      this.error.set('Token is expired');
      return;
    }
    this.error.set(null);
    this.auth.setToken(token);
    void this.router.navigate(['/']);
  }
}
