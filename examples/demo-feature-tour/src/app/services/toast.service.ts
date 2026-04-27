import { Injectable, signal } from '@angular/core';

export type ToastLevel = 'info' | 'success' | 'warn';

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly level: ToastLevel;
}

/**
 * Tiny in-memory toast service used by the `showToast` action. Demonstrates
 * how an `agenticAction` effect can talk to your existing app services
 * instead of inlining side-effecting code in a tool handler.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  readonly toasts = signal<readonly Toast[]>([]);

  show(message: string, level: ToastLevel = 'info', timeoutMs = 4000): void {
    const id = this.nextId++;
    const toast: Toast = { id, message, level };
    this.toasts.update((list) => [...list, toast]);
    setTimeout(() => this.dismiss(id), timeoutMs);
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
