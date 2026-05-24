import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { APPROVAL_DIFF_INPUTS } from '@infra-tools/agentic-ui';

/**
 * Diff renderer for the `redeemPoints` approval card (Capability F4 / HITL).
 * The approval card mounts this by name (`redeem-summary`) and provides the
 * pending approval's args + sign-off message via `APPROVAL_DIFF_INPUTS`.
 */
@Component({
  selector: 'app-redeem-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="diff">
      <p class="ask">{{ inputs?.signoffMessage }}</p>
      <dl>
        <div><dt>Points</dt><dd>{{ points().toLocaleString() }}</dd></div>
        <div><dt>Reward</dt><dd>{{ reward() }}</dd></div>
      </dl>
    </div>
  `,
  styles: `
    .diff { font-size: 0.85rem; }
    .ask { margin: 0 0 0.4rem; font-weight: 600; color: #111827; }
    dl { margin: 0; display: grid; gap: 0.2rem; }
    dl > div { display: flex; gap: 0.5rem; }
    dt { color: #6b7280; min-width: 4.5rem; }
    dd { margin: 0; color: #111827; font-weight: 500; }
  `,
})
export class RedeemSummaryComponent {
  protected readonly inputs = inject(APPROVAL_DIFF_INPUTS, { optional: true });

  private args(): Record<string, unknown> {
    const a = this.inputs?.args;
    return a && typeof a === 'object' ? (a as Record<string, unknown>) : {};
  }
  protected points(): number {
    return Number(this.args()['points'] ?? 0);
  }
  protected reward(): string {
    return String(this.args()['reward'] ?? '—');
  }
}
