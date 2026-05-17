import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import type { TrayNotification } from './notification-tray.component';

/**
 * Filter applied to the inbox list. `unread` shows only items where
 * `read === false`; `all` shows everything.
 */
export type InboxFilter = 'unread' | 'all';

/**
 * Full-page Inbox surface — Pillar 1 pattern 8 of
 * [post-chat-surfaces-plan.md](../../../../docs/plans/post-chat-surfaces-plan.md).
 *
 * The route-mounted companion to `<mvk-notification-tray>`. Same
 * `TrayNotification` shape feeds both surfaces, so hosts pipe one
 * store to both. Where the tray is a dropdown surface for at-a-
 * glance triage, the Inbox is the *settled* view — sortable
 * sections, filterable by read/unread, group-by source, with the
 * full body of each notification visible.
 *
 * Decoupled from any specific source: host wires `[notifications]`
 * from the same store that feeds the tray (typically populated by
 * `provideTriggerRunner({ onNotification })` from P2.1).
 *
 * @example
 * ```html
 * <!-- as a route component -->
 * <mvk-inbox
 *   [notifications]="inboxStore.list()"
 *   (activate)="onActivate($event)"
 *   (markRead)="inboxStore.markRead($event)"
 *   (markAllRead)="inboxStore.markAllRead()"
 *   (clearRead)="inboxStore.clearRead()" />
 * ```
 *
 * Persona scope: notifications can be persona-attributed via
 * `firedBy`. The host's store decides whether to filter by persona
 * before passing to the inbox; the inbox renders whatever it
 * receives. Audit attribution via `origin` (typically the trigger's
 * correlationId) makes each notification chain-hashable when the
 * host wires the action.
 */
@Component({
  selector: 'mvk-inbox',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="inbox" aria-label="Inbox">
      <header class="head">
        <h2 class="title">Inbox</h2>
        <div class="counts">
          <span class="count" aria-live="polite">{{ unreadCount() }} unread</span>
          <span class="count muted">· {{ totalCount() }} total</span>
        </div>
      </header>

      <nav class="filters" aria-label="Inbox filter">
        <button
          type="button"
          class="filter-btn"
          [class.active]="filter() === 'unread'"
          (click)="filter.set('unread')">Unread ({{ unreadCount() }})</button>
        <button
          type="button"
          class="filter-btn"
          [class.active]="filter() === 'all'"
          (click)="filter.set('all')">All ({{ totalCount() }})</button>

        <span class="spacer"></span>

        @if (unreadCount() > 0) {
          <button type="button" class="action-btn" (click)="markAllRead.emit()">Mark all read</button>
        }
        @if (readCount() > 0) {
          <button type="button" class="action-btn" (click)="clearRead.emit()">Clear read</button>
        }
      </nav>

      @if (visible().length === 0) {
        <p class="empty">
          @if (filter() === 'unread') { No unread notifications. } @else { Inbox is empty. }
        </p>
      } @else {
        <ul class="list" role="list">
          @for (n of visible(); track n.id) {
            <li
              class="item"
              [class.unread]="!n.read"
              [class.severity-info]="(n.draft.severity ?? 'info') === 'info'"
              [class.severity-warning]="n.draft.severity === 'warning'"
              [class.severity-error]="n.draft.severity === 'error'"
              tabindex="0"
              (click)="onActivate(n)"
              (keydown.enter)="onActivate(n)">
              <header class="item-head">
                <span class="dot" [attr.data-severity]="n.draft.severity ?? 'info'" aria-hidden="true"></span>
                <span class="item-title">{{ n.draft.title }}</span>
                <time class="ts" [attr.datetime]="n.firedAt">{{ formatTime(n.firedAt) }}</time>
              </header>
              @if (n.draft.body) {
                <p class="body">{{ n.draft.body }}</p>
              }
              <footer class="item-foot">
                @if (n.firedBy) {
                  <span class="attribution">From: {{ n.firedBy }}</span>
                }
                @if (n.origin) {
                  <span class="origin">{{ n.origin }}</span>
                }
                @if (n.draft.cta) {
                  <button type="button" class="cta-btn" (click)="onCta($event, n)">
                    {{ ctaLabel(n) }}
                  </button>
                }
              </footer>
            </li>
          }
        </ul>
      }
    </section>
  `,
  styles: `
    :host { display: block; font-family: system-ui, sans-serif; }
    .inbox { max-width: 760px; margin: 0 auto; padding: 1.5rem; }
    .head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 1rem; }
    .title { font-size: 1.5rem; font-weight: 700; margin: 0; color: #111827; }
    .counts { display: flex; gap: 0.4rem; align-items: baseline; font-size: 0.85rem; }
    .count { color: #111827; font-weight: 500; }
    .count.muted { color: #6b7280; font-weight: 400; }
    .filters { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem; padding-bottom: 0.6rem; border-bottom: 1px solid #e5e7eb; }
    .filter-btn {
      padding: 0.4rem 0.8rem;
      background: transparent; border: 0; border-radius: 0.4rem;
      cursor: pointer; font: inherit; color: #6b7280; font-size: 0.85rem;
    }
    .filter-btn:hover { background: #f3f4f6; }
    .filter-btn.active { background: #eef2ff; color: #4338ca; font-weight: 600; }
    .filter-btn:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; }
    .spacer { flex: 1; }
    .action-btn {
      padding: 0.4rem 0.7rem;
      background: white; border: 1px solid #e5e7eb; border-radius: 0.4rem;
      cursor: pointer; font: inherit; color: #4338ca; font-size: 0.8rem; font-weight: 500;
    }
    .action-btn:hover { background: #eef2ff; border-color: #c7d2fe; }
    .empty { text-align: center; padding: 3rem 1rem; color: #6b7280; font-size: 0.95rem; }
    .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
    .item {
      border: 1px solid #e5e7eb; border-radius: 0.5rem;
      padding: 0.8rem 1rem;
      cursor: pointer; outline: 0;
      background: white;
    }
    .item:hover { border-color: #c7d2fe; }
    .item:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; }
    .item.unread { background: #f5f3ff; border-color: #ddd6fe; }
    .item-head { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.3rem; }
    .dot { display: inline-block; width: 0.55rem; height: 0.55rem; border-radius: 50%; background: #6366f1; flex-shrink: 0; }
    .dot[data-severity="warning"] { background: #d97706; }
    .dot[data-severity="error"] { background: #dc2626; }
    .item-title { flex: 1; font-weight: 600; color: #111827; }
    .ts { color: #6b7280; font-size: 0.75rem; }
    .body { margin: 0.3rem 0; color: #4b5563; line-height: 1.45; }
    .item-foot { display: flex; align-items: center; gap: 0.6rem; margin-top: 0.4rem; font-size: 0.78rem; }
    .attribution { color: #6b7280; }
    .origin { color: #9ca3af; font-family: ui-monospace, monospace; font-size: 0.85em; }
    .cta-btn {
      margin-left: auto;
      padding: 0.35rem 0.7rem;
      background: #2563eb; color: white; border: 0;
      border-radius: 0.4rem; cursor: pointer; font: inherit;
      font-size: 0.8rem; font-weight: 600;
    }
    .cta-btn:hover { background: #1d4ed8; }
  `,
})
export class InboxComponent {
  /** Notifications to render — newest-first by convention. */
  readonly notifications = input<readonly TrayNotification[]>([]);

  /** Initial filter; defaults to 'unread'. Bound two-way via the filter buttons. */
  readonly initialFilter = input<InboxFilter>('unread');

  /** Click on an item → host dispatches the underlying action (typically `n.draft.cta`). */
  readonly activate = output<TrayNotification>();

  /** Mark an item read. */
  readonly markRead = output<string>();

  /** Mark all unread items read. */
  readonly markAllRead = output<void>();

  /** Remove the read items from the inbox (host's store responsibility). */
  readonly clearRead = output<void>();

  /** Current filter. Bound to filter buttons. */
  protected readonly filter = signal<InboxFilter>('unread');

  constructor() {
    // Hydrate from initialFilter once at construction; the filter
    // signal then becomes the source of truth for user interactions.
    queueMicrotask(() => this.filter.set(this.initialFilter()));
  }

  protected readonly unreadCount = computed(
    () => this.notifications().filter((n) => !n.read).length,
  );
  protected readonly totalCount = computed(() => this.notifications().length);
  protected readonly readCount = computed(
    () => this.totalCount() - this.unreadCount(),
  );

  protected readonly visible = computed<readonly TrayNotification[]>(() => {
    const all = this.notifications();
    if (this.filter() === 'unread') return all.filter((n) => !n.read);
    return all;
  });

  protected onActivate(n: TrayNotification): void {
    if (!n.read) this.markRead.emit(n.id);
    this.activate.emit(n);
  }

  protected onCta(ev: MouseEvent, n: TrayNotification): void {
    ev.stopPropagation();
    if (!n.read) this.markRead.emit(n.id);
    this.activate.emit(n);
  }

  protected ctaLabel(n: TrayNotification): string {
    const cta = n.draft.cta;
    if (!cta) return 'Open';
    if (cta.kind === 'route') return 'Open';
    if (cta.kind === 'action') return 'Run';
    if (cta.kind === 'tool') return 'Invoke';
    return 'Open';
  }

  protected formatTime(iso: string): string {
    const ts = Date.parse(iso);
    if (isNaN(ts)) return '';
    const date = new Date(ts);
    const diffMs = Date.now() - ts;
    const diffMin = Math.round(diffMs / 60_000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    // For older items, show absolute date — easier to scan in a long inbox.
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
}
