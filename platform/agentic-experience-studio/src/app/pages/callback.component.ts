import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../services/auth.service';

/**
 * OIDC redirect landing (P3 SSO). Reads `code` + `state` from the IdP redirect,
 * exchanges the code (with the stored PKCE verifier) for a token, then routes on.
 */
@Component({
  selector: 'aes-callback',
  imports: [RouterLink],
  template: `
    <div class="wrap">
      @if (error()) {
        <div class="card">
          <p class="err">Sign-in failed: {{ error() }}</p>
          <a class="btn" routerLink="/login">Back to sign in</a>
        </div>
      } @else {
        <div class="card"><span class="spin"></span> Completing sign-in…</div>
      }
    </div>
  `,
  styles: [`
    .wrap { display:grid; place-items:center; min-height:calc(100vh - 58px); }
    .card { display:flex; align-items:center; gap:12px; padding:20px 26px; border:1px solid var(--border);
      border-radius:12px; background:var(--surface); }
    .err { color:var(--danger); margin:0; }
    .spin { width:18px; height:18px; border:2px solid var(--brand-ring); border-top-color:var(--brand);
      border-radius:50%; animation:sp .7s linear infinite; display:inline-block; }
    @keyframes sp { to { transform:rotate(360deg); } }
    .btn { margin-left:12px; }
  `],
})
export class CallbackComponent {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly error = signal<string | null>(null);

  constructor() {
    const q = this.route.snapshot.queryParamMap;
    const code = q.get('code');
    const state = q.get('state');
    if (!code || !state) { this.error.set('missing code or state'); return; }
    this.auth.handleSsoCallback(code, state)
      .then(() => this.router.navigate(['/experiences']))
      .catch((e: Error) => this.error.set(e.message));
  }
}
