import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { Lifecycle } from './lifecycle';
import type { ApprovalAction, ApprovalState } from './services/capability-catalog.service';

/** What the bar emits: an approval-chain transition or a lifecycle move. */
export type BarAction =
  | { readonly type: 'approval'; readonly value: ApprovalAction }
  | { readonly type: 'lifecycle'; readonly value: Lifecycle };

interface BarButton {
  readonly label: string;
  readonly action: BarAction;
  readonly primary?: boolean;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly title?: string;
}

/**
 * Governance bar for a capability: shows the approval state + lifecycle and the
 * context-sensitive actions to move through the review chain
 * (draft → submit → review → approve → publish) with approve/reject gated by an
 * approver role, plus a History affordance. Emits the chosen action; the host
 * designer persists it (transition vs lifecycle patch) and refreshes.
 */
@Component({
  selector: 'aes-lifecycle-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="badge" [class.pub]="approvalState() === 'approved'" [class.rev]="approvalState() === 'review'"
      [class.rej]="approvalState() === 'rejected'">{{ approvalState() }}</span>
    <span class="lc">· {{ lifecycle() }}</span>
    @for (b of buttons(); track b.label) {
      <button class="lc-btn" type="button"
        [class.primary]="b.primary" [class.danger]="b.danger"
        [disabled]="busy() || b.disabled" [title]="b.title ?? ''"
        (click)="action.emit(b.action)">{{ b.label }}</button>
    }
    <button class="lc-btn ghost" type="button" [disabled]="busy()" (click)="history.emit()" title="Version history">History</button>
  `,
  styles: [`
    :host { display:inline-flex; align-items:center; gap:7px; flex-wrap:wrap; }
    .badge { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; padding:3px 9px; border-radius:999px; background:rgba(120,120,140,.15); }
    .badge.pub { background:rgba(10,125,50,.15); color:#0a7d32; }
    .badge.rev { background:rgba(203,143,0,.15); color:#a86a00; }
    .badge.rej { background:rgba(192,57,43,.13); color:#c0392b; }
    .lc { font-size:11px; opacity:.6; text-transform:uppercase; letter-spacing:.03em; }
    .lc-btn { font:inherit; font-size:12px; padding:5px 11px; border:1px solid rgba(120,120,140,.3); border-radius:8px; background:transparent; color:inherit; cursor:pointer; }
    .lc-btn:hover:not([disabled]) { border-color:#6750a4; color:#6750a4; }
    .lc-btn.primary { background:#6750a4; color:#fff; border-color:#6750a4; font-weight:600; }
    .lc-btn.primary:hover:not([disabled]) { color:#fff; }
    .lc-btn.danger:hover:not([disabled]) { border-color:#c0392b; color:#c0392b; }
    .lc-btn.ghost { opacity:.75; }
    .lc-btn[disabled] { opacity:.45; cursor:default; }
  `],
})
export class LifecycleBarComponent {
  readonly lifecycle = input.required<Lifecycle>();
  readonly approvalState = input.required<ApprovalState>();
  /** Whether the current user may approve/reject (approver role). */
  readonly canApprove = input(false);
  readonly busy = input(false);
  readonly action = output<BarAction>();
  readonly history = output<void>();

  protected readonly buttons = computed<BarButton[]>(() => {
    const s = this.approvalState();
    const lc = this.lifecycle();
    const canApprove = this.canApprove();
    const out: BarButton[] = [];
    if (s === 'draft' || s === 'rejected') {
      out.push({ label: 'Submit for review', action: { type: 'approval', value: 'submit' } });
    }
    if (s === 'review') {
      out.push({ label: 'Approve', primary: true, disabled: !canApprove, title: canApprove ? '' : 'Requires an approver role',
        action: { type: 'approval', value: 'approve' } });
      out.push({ label: 'Reject', danger: true, disabled: !canApprove, title: canApprove ? '' : 'Requires an approver role',
        action: { type: 'approval', value: 'reject' } });
    }
    if (s === 'approved') {
      if (lc !== 'published') out.push({ label: 'Publish', primary: true, action: { type: 'lifecycle', value: 'published' } });
      out.push({ label: 'Revoke', action: { type: 'approval', value: 'revoke' } });
    }
    if (lc === 'published') {
      out.push({ label: 'Deprecate', action: { type: 'lifecycle', value: 'deprecated' } });
      out.push({ label: 'Disable', danger: true, action: { type: 'lifecycle', value: 'disabled' } });
    } else if (lc === 'deprecated' || lc === 'disabled') {
      out.push({ label: 'Restore', action: { type: 'lifecycle', value: 'published' } });
    }
    return out;
  });
}
