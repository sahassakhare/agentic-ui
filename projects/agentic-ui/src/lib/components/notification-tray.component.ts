import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import type { NotificationDraft, TriggerFiringContext } from '../types/registry-defs';

/** One entry in the tray — a `NotificationDraft` plus its firing context. */
export interface TrayNotification {
  readonly id: string;
  readonly draft: NotificationDraft;
  readonly firedAt: string;          // ISO timestamp
  readonly firedBy?: string;         // persona id
  readonly read: boolean;
  /** Optional opaque origin tag, e.g. trigger correlationId, MFE source. */
  readonly origin?: string;
}

/**
 * Top-bar notification tray — Pillar 1 pattern 8 of
 * [post-chat-surfaces-plan.md](../../../../docs/plans/post-chat-surfaces-plan.md).
 *
 * Decoupled from any specific source: the host supplies
 * `[notifications]` (typically piped from its own store that ingests
 * trigger-fired notifications, push events, manual posts, etc.) and
 * the tray renders a bell icon + unread-count badge. Click opens a
 * dropdown listing the notifications; click an item emits
 * `(activate)` so the host can dispatch the cta.
 *
 * The companion `<mvk-inbox>` (P2.3) renders the same data as a
 * full-page route — they share the `TrayNotification` shape so apps
 * can pipe one store to both surfaces.
 *
 * Wires naturally with `provideTriggerRunner({ onNotification })`
 * from P2.1 — the host's `onNotification` callback pushes the draft
 * into its store, which feeds `[notifications]` into this tray.
 *
 * @example
 * ```ts
 * provideTriggerRunner({
 *   onNotification: (draft, ctx) => this.inboxStore.push({
 *     id: ctx.correlationId,
 *     draft,
 *     firedAt: ctx.firedAt,
 *     firedBy: ctx.firedBy,
 *     read: false,
 *     origin: ctx.triggerId,
 *   }),
 * });
 * ```
 *
 * ```html
 * <mvk-notification-tray
 *   [notifications]="inboxStore.list()"
 *   (activate)="onNotificationActivate($event)"
 *   (markRead)="inboxStore.markRead($event)"
 *   (markAllRead)="inboxStore.markAllRead()" />
 * ```
 */
@Component({
  selector: 'mvk-notification-tray',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="bell"
      aria-label="Notifications"
      [attr.aria-expanded]="isOpen()"
      [attr.aria-haspopup]="'menu'"
      (click)="toggle($event)">
      <span class="bell-icon" aria-hidden="true">🔔</span>
      @if (unreadCount() > 0) {
        <span class="badge" aria-live="polite" [attr.aria-label]="unreadCount() + ' unread'">
          {{ unreadCount() > 99 ? '99+' : unreadCount() }}
        </span>
      }
    </button>

    @if (isOpen()) {
      <div class="dropdown" role="menu">
        <header class="dropdown-header">
          <span class="title">Notifications</span>
          @if (unreadCount() > 0) {
            <button type="button" class="mark-all" (click)="onMarkAllRead()">Mark all read</button>
          }
        </header>
        @if (notifications().length === 0) {
          <p class="empty">Nothing new.</p>
        } @else {
          <ul class="list" role="list">
            @for (n of notifications(); track n.id) {
              <li
                class="item"
                role="menuitem"
                [class.unread]="!n.read"
                [class.severity-info]="(n.draft.severity ?? 'info') === 'info'"
                [class.severity-warning]="n.draft.severity === 'warning'"
                [class.severity-error]="n.draft.severity === 'error'"
                tabindex="0"
                (click)="onActivate(n)"
                (keydown.enter)="onActivate(n)">
                <header class="item-header">
                  <span class="dot" [attr.data-severity]="n.draft.severity ?? 'info'" aria-hidden="true"></span>
                  <span class="title">{{ n.draft.title }}</span>
                  <time class="ts" [attr.datetime]="n.firedAt">{{ relativeTime(n.firedAt) }}</time>
                </header>
                @if (n.draft.body) {
                  <p class="body">{{ n.draft.body }}</p>
                }
              </li>
            }
          </ul>
        }
      </div>
    }
  `,
  styles: `
    :host { display: inline-block; position: relative; font-family: system-ui, sans-serif; }
    .bell {
      background: transparent; border: 0; cursor: pointer;
      padding: 0.35rem; border-radius: 0.4rem; position: relative;
      font-size: 1.05rem; line-height: 1;
    }
    .bell:hover { background: #f3f4f6; }
    .bell:focus-visible { outline: 2px solid #6366f1; outline-offset: 1px; }
    .badge {
      position: absolute; top: 0; right: 0;
      background: #dc2626; color: white;
      min-width: 1.1rem; height: 1.1rem;
      border-radius: 999px; padding: 0 0.3rem;
      font-size: 0.65rem; font-weight: 700; line-height: 1.1rem;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .dropdown {
      position: absolute; right: 0; top: calc(100% + 6px);
      width: min(360px, calc(100vw - 2rem));
      max-height: 70vh; overflow-y: auto;
      background: white; border: 1px solid #e5e7eb; border-radius: 0.5rem;
      box-shadow: 0 8px 28px rgba(15, 23, 42, 0.12);
      z-index: 40;
    }
    .dropdown-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.7rem 0.9rem; border-bottom: 1px solid #e5e7eb;
      font-size: 0.85rem; font-weight: 600; color: #111827;
    }
    .mark-all {
      background: transparent; border: 0; color: #4338ca; cursor: pointer;
      font: inherit; font-size: 0.75em; font-weight: 600;
    }
    .empty { padding: 1rem; text-align: center; color: #6b7280; margin: 0; font-size: 0.9em; }
    .list { list-style: none; margin: 0; padding: 0; }
    .item {
      padding: 0.6rem 0.9rem;
      border-bottom: 1px solid #f3f4f6;
      cursor: pointer;
      font-size: 0.85rem;
    }
    .item:hover { background: #f9fafb; }
    .item.unread { background: #eef2ff; }
    .item.unread:hover { background: #e0e7ff; }
    .item-header { display: flex; align-items: center; gap: 0.4rem; }
    .dot {
      display: inline-block; width: 0.5rem; height: 0.5rem;
      border-radius: 50%; flex-shrink: 0; background: #6366f1;
    }
    .dot[data-severity="warning"] { background: #d97706; }
    .dot[data-severity="error"] { background: #dc2626; }
    .item .title { flex: 1; font-weight: 500; color: #111827; }
    .ts { color: #6b7280; font-size: 0.75em; }
    .body { margin: 0.3rem 0 0 1rem; color: #4b5563; line-height: 1.35; }
  `,
})
export class NotificationTrayComponent {
  /** Notifications to render — newest-first by convention. */
  readonly notifications = input<readonly TrayNotification[]>([]);

  /** Click on a notification → host dispatches its `draft.cta`. */
  readonly activate = output<TrayNotification>();

  /** Click on a notification → host's store marks it read. */
  readonly markRead = output<string>();

  /** Click on "Mark all read" → host's store clears unread. */
  readonly markAllRead = output<void>();

  protected readonly isOpen = signal(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly unreadCount = computed(
    () => this.notifications().filter((n) => !n.read).length,
  );

  protected toggle(ev: MouseEvent): void {
    ev.stopPropagation();
    this.isOpen.update((v) => !v);
  }

  protected onActivate(n: TrayNotification): void {
    if (!n.read) this.markRead.emit(n.id);
    this.activate.emit(n);
    this.isOpen.set(false);
  }

  protected onMarkAllRead(): void {
    this.markAllRead.emit();
  }

  /** Render an ISO timestamp as a relative-time label (minutes / hours / days). */
  protected relativeTime(iso: string): string {
    const ts = Date.parse(iso);
    if (isNaN(ts)) return '';
    const diffMs = Date.now() - ts;
    const diffMin = Math.round(diffMs / 60_000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m`;
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24) return `${diffH}h`;
    const diffD = Math.round(diffH / 24);
    return `${diffD}d`;
  }

  /** Close on outside click. */
  @HostListener('document:mousedown', ['$event'])
  protected onDocumentMousedown(ev: MouseEvent): void {
    if (!this.isOpen()) return;
    if (!this.host.nativeElement.contains(ev.target as Node)) {
      this.isOpen.set(false);
    }
  }

  /** Close on global Escape. */
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.isOpen()) this.isOpen.set(false);
  }
}
