import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { lifecycleTransitions, type Lifecycle } from './lifecycle';

/**
 * Reusable lifecycle control: a state badge + the valid transition buttons.
 * Dropped into each visual designer's header so authors can publish/deprecate/
 * disable/restore in place — the governance the generic Capability Studio has,
 * now inside every designer. Emits the target state; the host persists it.
 */
@Component({
  selector: 'aes-lifecycle-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="badge"
      [class.pub]="lifecycle() === 'published'"
      [class.draft]="lifecycle() === 'draft'"
      [class.dis]="lifecycle() === 'deprecated' || lifecycle() === 'disabled'">{{ lifecycle() }}</span>
    @for (t of transitions(); track t.to) {
      <button class="lc-btn" type="button" [disabled]="busy()" (click)="transition.emit(t.to)">{{ t.label }}</button>
    }
  `,
  styles: [`
    :host { display:inline-flex; align-items:center; gap:8px; }
    .badge { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; padding:3px 9px; border-radius:999px; background:rgba(120,120,140,.15); }
    .badge.pub { background:rgba(10,125,50,.15); color:#0a7d32; }
    .badge.draft { background:rgba(203,143,0,.15); color:#a86a00; }
    .badge.dis { background:rgba(192,57,43,.13); color:#c0392b; }
    .lc-btn { font:inherit; font-size:12px; padding:5px 11px; border:1px solid rgba(120,120,140,.3); border-radius:8px; background:transparent; color:inherit; cursor:pointer; }
    .lc-btn:hover:not([disabled]) { border-color:#6750a4; color:#6750a4; } .lc-btn[disabled] { opacity:.5; cursor:default; }
  `],
})
export class LifecycleBarComponent {
  readonly lifecycle = input.required<Lifecycle>();
  readonly busy = input(false);
  readonly transition = output<Lifecycle>();
  protected readonly transitions = computed(() => lifecycleTransitions(this.lifecycle()));
}
