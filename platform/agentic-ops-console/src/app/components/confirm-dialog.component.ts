import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

/**
 * Reusable confirmation dialog. Used by destructive / lifecycle
 * actions (suspend, delete) so the operator has a chance to bail
 * out plus, where applicable, supply an audit-trail reason.
 *
 * Usage:
 * ```html
 * @if (confirmOpen()) {
 *   <ops-confirm-dialog
 *     title="Suspend tenant"
 *     message="The tenant won't be able to mint new sessions until reactivated."
 *     [requireReason]="true"
 *     (confirm)="reallySuspend($event)"
 *     (cancel)="confirmOpen.set(false)" />
 * }
 * ```
 */
@Component({
  selector: 'ops-confirm-dialog',
  imports: [FormsModule],
  template: `
    <div class="backdrop" (click)="cancel.emit()">
      <div class="dialog" role="dialog" aria-modal="true" (click)="$event.stopPropagation()">
        <h2>{{ title }}</h2>
        @if (message) { <p>{{ message }}</p> }
        @if (requireReason) {
          <label class="dim small">Reason (required, audited)</label>
          <textarea [(ngModel)]="reason" rows="3" placeholder="e.g. overdue invoice"></textarea>
        }
        <div class="actions">
          <button class="btn" type="button" (click)="cancel.emit()">Cancel</button>
          <button
            class="btn primary"
            [class.bad]="destructive"
            type="button"
            [disabled]="requireReason && !reason.trim()"
            (click)="onConfirm()"
          >
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: contents; }
    .backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.6);
      display: grid; place-items: center;
      z-index: 100;
    }
    .dialog {
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      max-width: 480px;
      width: 90vw;
      display: flex; flex-direction: column; gap: 12px;
    }
    h2 { margin: 0; font-size: 18px; }
    p { margin: 0; color: var(--fg-muted); }
    label { display: block; margin-bottom: 4px; }
    textarea {
      background: var(--bg);
      color: var(--fg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      width: 100%;
      resize: vertical;
      font: inherit;
    }
    textarea:focus { outline: none; border-color: var(--accent); }
    .small { font-size: 11px; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
    .btn.bad {
      background: var(--bad);
      border-color: var(--bad);
      color: white;
    }
    .btn.bad:disabled { opacity: 0.5; cursor: not-allowed; }
  `],
})
export class ConfirmDialogComponent {
  @Input({ required: true }) title!: string;
  @Input() message: string = '';
  @Input() confirmLabel: string = 'Confirm';
  @Input() destructive: boolean = false;
  @Input() requireReason: boolean = false;

  @Output() confirm = new EventEmitter<{ reason: string }>();
  @Output() cancel = new EventEmitter<void>();

  reason: string = '';

  onConfirm(): void {
    if (this.requireReason && !this.reason.trim()) return;
    this.confirm.emit({ reason: this.reason.trim() });
  }
}
