import { Injectable, signal } from '@angular/core';

export type ToastKind = 'ok' | 'danger' | 'info';

export interface Toast {
  readonly id: number;
  readonly kind: ToastKind;
  readonly title: string;
  readonly message?: string;
  /** Optional inline action (e.g. Undo). Invoking it dismisses the toast. */
  readonly action?: { readonly label: string; readonly run: () => void };
}

/**
 * App-wide, signal-based toast store (AEP Seam E UX). Components call
 * `success` / `error` / `info`; the single {@link ToastHostComponent} mounted
 * in the shell renders the stack. Auto-dismiss is timer-based and cancelled if
 * the toast is closed early. Actionable toasts (Undo) stay a little longer.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private seq = 0;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  readonly toasts = signal<readonly Toast[]>([]);

  success(title: string, message?: string): void { this.push('ok', title, message); }
  error(title: string, message?: string): void { this.push('danger', title, message, 6500); }
  info(title: string, message?: string): void { this.push('info', title, message); }

  /** A toast with an inline action button (e.g. Undo a delete). */
  withAction(kind: ToastKind, title: string, label: string, run: () => void, message?: string): void {
    this.push(kind, title, message, 7000, { label, run });
  }

  dismiss(id: number): void {
    const t = this.timers.get(id);
    if (t) { clearTimeout(t); this.timers.delete(id); }
    this.toasts.update((list) => list.filter((x) => x.id !== id));
  }

  private push(kind: ToastKind, title: string, message: string | undefined, ttl = 4000, action?: Toast['action']): void {
    const id = ++this.seq;
    const toast: Toast = { id, kind, title, ...(message ? { message } : {}), ...(action ? { action } : {}) };
    this.toasts.update((list) => [...list, toast]);
    const timer = setTimeout(() => this.dismiss(id), ttl);
    this.timers.set(id, timer);
  }
}
