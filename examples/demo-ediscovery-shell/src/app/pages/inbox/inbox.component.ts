import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { InboxComponent as MvkInbox, type TrayNotification } from '@infra-tools/agentic-ui';
import { NotificationsStore } from '../../services/notifications.store';

/**
 * `/inbox` route — full-page notifications surface (post-chat-surfaces P2).
 *
 * Reads from the host's `NotificationsStore` (in-memory, seeded at boot
 * for the demo). The `<mvk-inbox>` widget is dispatch-agnostic — when
 * the user clicks an item it emits `(activate)` with the notification,
 * and we dispatch the `draft.cta` here. The demo only handles route
 * CTAs; production hosts would route through Router / ActionRegistry /
 * ToolRegistry depending on the `cta.kind`.
 */
@Component({
  selector: 'app-inbox-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MvkInbox],
  template: `
    <section class="page-head">
      <div>
        <p class="crumb">Workload</p>
        <h1>Inbox</h1>
        <p class="muted">
          {{ store.unreadCount() }} unread · {{ store.notifications().length }} total
        </p>
      </div>
      <button class="btn" (click)="store.markAllRead()" [disabled]="store.unreadCount() === 0">
        Mark all read
      </button>
    </section>
    <mvk-inbox
      [notifications]="store.notifications()"
      initialFilter="unread"
      (activate)="onActivate($event)" />
  `,
  styles: `
    :host { display: block; max-width: 920px; }
    .page-head { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: var(--s-5); gap: var(--s-4); }
    .page-head h1 { margin: 0.2rem 0 0; font-size: var(--fs-2xl); letter-spacing: -0.01em; }
    .crumb { margin: 0; font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-text-faint); }
    .muted { margin: 0.4rem 0 0; color: var(--c-text-2); font-size: var(--fs-sm); }
    .btn {
      padding: 0.45rem 0.9rem; background: var(--c-surface); border: 1px solid var(--c-border);
      border-radius: var(--r-md); font-size: var(--fs-sm); cursor: pointer; color: var(--c-text-1);
    }
    .btn:hover:not(:disabled) { background: var(--c-surface-1); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  `,
})
export class InboxPage {
  protected readonly store = inject(NotificationsStore);
  private readonly router = inject(Router);

  protected onActivate(n: TrayNotification): void {
    this.store.markRead(n.id);
    const cta = n.draft.cta;
    if (cta?.kind === 'route') void this.router.navigateByUrl(cta.target);
    // tool / action CTAs would dispatch through ToolRegistry /
    // ActionRegistry here; the demo just navigates.
  }
}
