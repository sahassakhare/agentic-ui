import { Component, inject } from '@angular/core';
import { ToastService, type Toast } from '../services/toast.service';

/**
 * Renders the app's toast stack (AEP Seam E UX). Mounted once in the shell.
 * Uses the global `.toast-*` design-system classes. `aria-live="polite"` so
 * screen readers announce transient feedback without stealing focus.
 */
@Component({
  selector: 'aes-toast-host',
  template: `
    <div class="toast-stack" role="status" aria-live="polite" aria-atomic="false">
      @for (t of toasts.toasts(); track t.id) {
        <div class="toast" [class.ok]="t.kind === 'ok'" [class.danger]="t.kind === 'danger'">
          <div class="toast-body">
            <div class="toast-title">{{ t.title }}</div>
            @if (t.message) { <div class="toast-msg">{{ t.message }}</div> }
          </div>
          @if (t.action) {
            <button class="undo" type="button" (click)="run(t)">{{ t.action.label }}</button>
          }
          <button class="close" type="button" aria-label="Dismiss" (click)="toasts.dismiss(t.id)">×</button>
        </div>
      }
    </div>
  `,
})
export class ToastHostComponent {
  protected readonly toasts = inject(ToastService);

  run(t: Toast): void {
    t.action?.run();
    this.toasts.dismiss(t.id);
  }
}
