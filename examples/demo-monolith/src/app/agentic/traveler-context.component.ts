import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TravelerContextService, type TravelerContext } from './traveler-context.service';

/**
 * Shared-state editor. Whatever you set here is sent to the agent on the
 * next turn (via `AGENTIC_RUN_STATE_PROVIDER` → `AgenticRunInput.state`),
 * so the agent's answers reflect it — without it being part of the chat
 * message. Edit the tier and ask "what lounge access do I have?" to see
 * the agent respond in context.
 */
@Component({
  selector: 'app-traveler-context',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="ctx">
      <label>
        <span>Name</span>
        <input type="text" [ngModel]="ctx().name" (ngModelChange)="svc.update({ name: $event })" />
      </label>
      <label>
        <span>Tier</span>
        <select [ngModel]="ctx().tier" (ngModelChange)="svc.update({ tier: $event })">
          <option value="silver">silver</option>
          <option value="gold">gold</option>
          <option value="platinum">platinum</option>
        </select>
      </label>
      <label>
        <span>Home airport</span>
        <input type="text" [ngModel]="ctx().homeAirport" (ngModelChange)="svc.update({ homeAirport: ($event || '').toUpperCase() })" maxlength="4" />
      </label>
      <p class="wire">Sent to the agent as <code>state</code>: <code>{{ asJson() }}</code></p>
    </div>
  `,
  styles: `
    .ctx { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: flex-end; }
    label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.8rem; color: #374151; }
    label span { font-weight: 600; }
    input, select { padding: 0.35rem 0.5rem; border: 1px solid #d1d5db; border-radius: 0.3rem; font: inherit; }
    input[type="text"] { width: 9rem; }
    .wire { width: 100%; margin: 0.25rem 0 0; font-size: 0.75rem; color: #6b7280; }
    .wire code { background: #f1f5f9; padding: 1px 5px; border-radius: 3px; }
  `,
})
export class TravelerContextComponent {
  protected readonly svc = inject(TravelerContextService);
  protected readonly ctx = this.svc.value;
  protected asJson(): string {
    const c: TravelerContext = this.ctx();
    return JSON.stringify(c);
  }
}
