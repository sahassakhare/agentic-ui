import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { AuthService, decodeTenant } from '../services/auth.service';

/**
 * Login screen (AEP Seam E). In `oidc` mode the user pastes a JWT and the
 * tenant is decoded from its claims; in `disabled` mode the user types a
 * tenant id (ADR-022). Mirrors the ops-console login contract.
 */
@Component({
  selector: 'aes-login',
  imports: [FormsModule],
  template: `
    <div class="card">
      <h1>Experience Studio</h1>
      @if (auth.authMode === 'oidc') {
        <p class="muted">Paste a catalog JWT to sign in. The tenant is read from the token.</p>
        <textarea rows="4" [(ngModel)]="token" placeholder="eyJhbGciOi…"></textarea>
        @if (previewTenant()) { <p class="hint">tenant: <code>{{ previewTenant() }}</code></p> }
        <button [disabled]="!token.trim()" (click)="signInOidc()">Sign in</button>
      } @else {
        <p class="muted">Auth is disabled on this catalog. Enter a tenant id.</p>
        <input [(ngModel)]="tenant" placeholder="test-tenant" />
        <button [disabled]="!tenant.trim()" (click)="signInDisabled()">Continue</button>
      }
      @if (error()) { <p class="error">{{ error() }}</p> }
    </div>
  `,
  styles: [`
    .card { max-width: 460px; margin: 4rem auto; display: flex; flex-direction: column; gap: .75rem;
      padding: 1.5rem; border: 1px solid color-mix(in srgb, currentColor 15%, transparent); border-radius: 12px; }
    textarea, input { padding: .5rem; font: inherit; }
    button { padding: .5rem 1rem; justify-self: start; }
    .muted { opacity: .7; } .hint { font-size: .8rem; opacity: .8; } .error { color: crimson; }
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
