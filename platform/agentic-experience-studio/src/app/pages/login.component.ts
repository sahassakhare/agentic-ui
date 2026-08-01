import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService, decodeTenant } from '../services/auth.service';

/**
 * Login screen (AEP Seam E). In `oidc` mode the user pastes a JWT and the
 * tenant is decoded from its claims; in `disabled` mode the user types a
 * tenant id (ADR-022). Mirrors the ops-console login contract. Product-grade
 * centered auth card using the design-system tokens.
 */
@Component({
  selector: 'aes-login',
  imports: [FormsModule],
  template: `
    <div class="wrap">
      <div class="card card-pad auth">
        <div class="brand">
          <span class="mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
              <path d="M12 12 3 7m9 5 9-5m-9 5v10" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" opacity=".55"/>
            </svg>
          </span>
          <div class="stack" style="gap:0">
            <strong>Experience Studio</strong>
            <span class="faint" style="font-size:var(--fs-xs)">Agentic Experience Platform · Seam E</span>
          </div>
        </div>

        @if (auth.authMode === 'oidc') {
          <button class="btn btn-primary" type="button" (click)="auth.loginWithSso()" style="width:100%; justify-content:center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Sign in with SSO
          </button>
          <div class="or"><span>or paste a token (dev)</span></div>
          <form class="stack" (ngSubmit)="signInOidc()">
            <div class="field">
              <label class="label" for="tok">Catalog token</label>
              <textarea class="textarea mono" id="tok" name="tok" rows="3" [(ngModel)]="token" placeholder="eyJhbGciOi…" spellcheck="false"
                [attr.aria-invalid]="!!error()"></textarea>
              @if (previewTenant()) { <span class="help">Tenant: <code>{{ previewTenant() }}</code></span> }
            </div>
            @if (error()) { <p class="err" role="alert">{{ error() }}</p> }
            <button class="btn" type="submit" [disabled]="!token.trim()">Use token</button>
          </form>
        } @else {
          <form class="stack" (ngSubmit)="signInDisabled()">
            <div class="notice">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 9v4m0 4h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
              Auth is disabled on this catalog — demo / trusted-network only.
            </div>
            <div class="field">
              <label class="label" for="tenant">Tenant</label>
              <input class="input" id="tenant" name="tenant" [(ngModel)]="tenant" placeholder="acme" autocomplete="off" spellcheck="false" />
            </div>
            <button class="btn btn-primary" type="submit" [disabled]="!tenant.trim()">Open tenant</button>
          </form>
        }
      </div>
    </div>
  `,
  styles: [`
    .wrap { min-height: calc(100vh - 58px); display: grid; place-items: center; padding: var(--s5); }
    .auth { width: 100%; max-width: 420px; display: flex; flex-direction: column; gap: var(--s5); }
    .brand { display: flex; align-items: center; gap: var(--s3); }
    .mark { width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; background: var(--brand); color: var(--on-brand); box-shadow: var(--shadow-1); }
    .brand strong { font-size: var(--fs-lg); letter-spacing: -.01em; }
    .notice { display: flex; align-items: flex-start; gap: var(--s2); font-size: var(--fs-sm); color: var(--warn);
      background: var(--warn-soft); border: 1px solid var(--warn-border); border-radius: var(--r-sm); padding: var(--s3); }
    .err { color: var(--danger); font-size: var(--fs-sm); margin: 0; }
    .or { display: flex; align-items: center; gap: 10px; color: var(--text-faint); font-size: var(--fs-xs); }
    .or::before, .or::after { content: ""; flex: 1; height: 1px; background: var(--border); }
  `],
})
export class LoginComponent {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  token = '';
  tenant = '';
  readonly error = signal<string | null>(null);

  previewTenant(): string | null {
    return this.token.trim() ? decodeTenant(this.token.trim()) : null;
  }

  signInOidc(): void {
    const t = this.token.trim();
    if (!decodeTenant(t)) { this.error.set('Token has no tenant claim (tenant_id).'); return; }
    this.auth.setToken(t);
    void this.router.navigate(['/experiences']);
  }

  signInDisabled(): void {
    this.auth.setTenant(this.tenant.trim());
    void this.router.navigate(['/experiences']);
  }
}
