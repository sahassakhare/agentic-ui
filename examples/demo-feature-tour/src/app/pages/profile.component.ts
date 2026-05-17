import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ProfileService } from '../services/profile.service';

@Component({
  selector: 'app-profile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2>Profile</h2>
    <p class="muted">Reads from <code>ProfileService</code>. The
      <code>profileForm</code> from <code>FormRegistry</code> writes back here
      on submit — same data, two consumers.</p>
    <dl>
      <dt>User id</dt><dd>{{ p().userId }}</dd>
      <dt>Full name</dt><dd>{{ p().fullName }}</dd>
      <dt>Email</dt><dd>{{ p().email }}</dd>
      <dt>Newsletter</dt><dd>{{ p().newsletter ? 'Subscribed' : 'Unsubscribed' }}</dd>
    </dl>
  `,
  styles: `
    :host { display: block; }
    h2 { margin: 0 0 0.5rem; font-size: 1.3rem; }
    .muted { color: #475569; margin-bottom: 1rem; }
    code { background: #e2e8f0; padding: 1px 5px; border-radius: 3px; font-size: 0.85em; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.4rem 1.2rem; margin: 0; }
    dt { color: #64748b; font-size: 0.85rem; }
    dd { margin: 0; color: #0f172a; }
  `,
})
export class ProfileComponent {
  private readonly profileService = inject(ProfileService);
  protected readonly p = this.profileService.profile;
}
