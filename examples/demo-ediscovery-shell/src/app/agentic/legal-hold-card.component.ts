import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Generative-UI widget for a legal hold. Rendered when a tool returns
 * `components: [{ name: 'legalHoldCard', props }]`.
 */
@Component({
  selector: 'app-legal-hold-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card">
      <header>
        <span class="badge">legal hold</span>
        <strong>{{ holdId() }}</strong>
        @if (released()) {
          <span class="status released">released</span>
        } @else if (acknowledged()) {
          <span class="status active">acknowledged</span>
        } @else {
          <span class="status pending">pending ack</span>
        }
      </header>
      <p class="scope">{{ scope() }}</p>
      <p class="ref">
        <strong>{{ custodianCount() }}</strong> custodian(s) covered ·
        issued {{ issuedAt() }}
      </p>
    </article>
  `,
  styles: `
    .card { padding: 0.7rem 0.9rem; border: 1px solid #d1d5db; border-radius: 0.5rem; background: #fff; margin-top: 0.5rem; font: 0.88rem system-ui; border-left: 4px solid #d97706; }
    header { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
    .badge { font-size: 0.7em; padding: 2px 6px; border-radius: 4px; background: #fef3c7; color: #92400e; text-transform: uppercase; letter-spacing: 0.04em; }
    .status { font-size: 0.7em; padding: 2px 8px; border-radius: 999px; margin-left: auto; }
    .status.active { background: #d1fae5; color: #065f46; }
    .status.pending { background: #fef3c7; color: #92400e; }
    .status.released { background: #f3f4f6; color: #6b7280; }
    .scope { margin: 0.4rem 0 0.2rem; color: #475569; font-size: 0.88em; line-height: 1.4; }
    .ref { margin: 0.2rem 0 0; color: #94a3b8; font-size: 0.78em; }
    .ref strong { color: #475569; }
  `,
})
export class LegalHoldCardComponent {
  readonly holdId = input.required<string>();
  readonly scope = input.required<string>();
  readonly custodianCount = input.required<number>();
  readonly issuedAt = input.required<string>();
  readonly acknowledged = input.required<boolean>();
  readonly released = input.required<boolean>();
}
