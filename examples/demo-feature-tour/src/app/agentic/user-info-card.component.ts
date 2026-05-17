import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Generative-UI widget for `userInfoCard`. Rendered when the
 * `lookupUser` tool returns a result — proving a tool can drive a
 * `DataSourceRegistry` query and surface the result through a typed
 * widget without hard-coding a fetch URL.
 */
@Component({
  selector: 'app-user-info-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card">
      <header>
        <span class="badge">user</span>
        <span class="title">{{ fullName() }}</span>
        <span class="tier">{{ tier() }}</span>
      </header>
      <p class="ref">id: <code>{{ userId() }}</code></p>
      <p class="muted">last seen: {{ lastSeen() }}</p>
    </article>
  `,
  styles: `
    .card { padding: 0.6rem 0.8rem; border: 1px solid #d1d5db; border-radius: 0.5rem; background: #fff; margin-top: 0.5rem; font: 0.9rem system-ui; border-left: 4px solid #4f46e5; }
    header { display: flex; gap: 0.6rem; align-items: center; }
    .badge { font-size: 0.7em; padding: 2px 6px; border-radius: 4px; background: #e0e7ff; color: #3730a3; text-transform: uppercase; letter-spacing: 0.04em; }
    .title { flex: 1; font-weight: 600; }
    .tier { font-size: 0.75em; padding: 2px 8px; border-radius: 999px; background: #fef3c7; color: #92400e; text-transform: uppercase; letter-spacing: 0.04em; }
    .ref { margin: 0.3rem 0 0; color: #4b5563; font-size: 0.85em; }
    .muted { margin: 0.15rem 0 0; color: #6b7280; font-size: 0.8em; }
  `,
})
export class UserInfoCardComponent {
  readonly userId = input.required<string>();
  readonly fullName = input.required<string>();
  readonly tier = input.required<string>();
  readonly lastSeen = input.required<string>();
}
