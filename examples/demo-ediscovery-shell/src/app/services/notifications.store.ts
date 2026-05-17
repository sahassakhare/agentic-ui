import { computed, Injectable, signal } from '@angular/core';
import type { TrayNotification } from '@infra-tools/agentic-ui';
import { isoNow, nextAuditId } from '@infra-tools/demo-ediscovery-shared';

/**
 * Host-owned notification feed. Backs `<mvk-notification-tray>` (header
 * chrome) and `<mvk-inbox>` (full /inbox route). Trigger firings, push
 * events, and the LLM's `notify` action would all feed in here; for the
 * demo we seed it at boot so the surfaces have content immediately.
 *
 * Library is dispatch-agnostic — `<mvk-inbox>` emits `(activate)` with
 * the whole `TrayNotification`, and the host route component decides
 * what to do (typically dispatch `n.draft.cta` through Router / Action /
 * Tool).
 */
@Injectable({ providedIn: 'root' })
export class NotificationsStore {
  private readonly _notifications = signal<TrayNotification[]>([
    {
      id: nextAuditId(),
      firedAt: isoNow(),
      firedBy: 'trigger',
      origin: 'trigger:dailyAckSweep',
      read: false,
      draft: {
        title: '3 hold acknowledgements still pending',
        body:
          "Daily sweep flagged custodians without an acknowledged hold. " +
          'Open the Holds page to nudge them.',
        severity: 'warning',
        cta: { kind: 'route', target: '/holds' },
      },
    },
    {
      id: nextAuditId(),
      firedAt: isoNow(),
      firedBy: 'trigger',
      origin: 'trigger:productionReady',
      read: false,
      draft: {
        title: 'Production PROD-002 finished export',
        body: 'Bates stamping complete. Ready for chain-of-custody report.',
        severity: 'info',
        cta: { kind: 'route', target: '/productions' },
      },
    },
    {
      id: nextAuditId(),
      firedAt: isoNow(),
      firedBy: 'system',
      origin: 'demo-seed',
      read: true,
      draft: {
        title: 'Welcome to the post-chat surfaces tour',
        body:
          'Notifications land in the bell tray (top right) and in this Inbox route. ' +
          'Try the Dashboards + Playbooks links in the left rail next.',
        severity: 'info',
      },
    },
  ]);

  readonly notifications = this._notifications.asReadonly();
  readonly unreadCount = computed(() => this._notifications().filter((n) => !n.read).length);

  add(n: TrayNotification): void {
    this._notifications.update((arr) => [n, ...arr]);
  }

  markRead(id: string): void {
    this._notifications.update((arr) =>
      arr.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
  }

  markAllRead(): void {
    this._notifications.update((arr) => arr.map((n) => ({ ...n, read: true })));
  }
}
