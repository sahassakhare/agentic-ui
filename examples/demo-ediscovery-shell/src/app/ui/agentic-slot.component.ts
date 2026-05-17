import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { WidgetContainerComponent } from '@infra-tools/agentic-ui';
import { RenderHandoffStore, type ComponentSpec } from '../services/render-handoff.store';

/**
 * Named mount-point for components stashed in `RenderHandoffStore`.
 * Drop one of these on any page that should be reachable as a tool's
 * render target (plan R1):
 *
 * ```html
 * <mvk-agentic-slot name="holds.primary"></mvk-agentic-slot>
 * ```
 *
 * On activation, the slot consumes whatever the most recent tool
 * handler published under that key, mounts each component via the
 * library's `<mvk-widget-container>`, and clears the slot so a
 * refresh shows the static page state.
 *
 * Slots that are empty render nothing (no placeholder, no chrome).
 * Hosts that want a "no recent handoff" affordance can wrap the slot
 * with their own conditional content.
 */
@Component({
  selector: 'mvk-agentic-slot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WidgetContainerComponent],
  template: `
    @if (instances().length > 0) {
      <section class="handoff" role="region" [attr.aria-label]="'Agent handoff: ' + name()">
        @for (w of instances(); track w.widgetCallId) {
          <mvk-widget-container [widget]="w" />
        }
      </section>
    }
  `,
  styles: `
    :host { display: block; }
    .handoff {
      display: flex; flex-direction: column; gap: 1rem;
      margin-bottom: 1.5rem;
      padding: 1rem;
      background: var(--c-surface, #fff);
      border: 1px solid var(--c-border, #e5e7eb);
      border-left: 3px solid var(--c-accent, #3b82f6);
      border-radius: 0.5rem;
    }
  `,
})
export class AgenticSlotComponent {
  /** Slot key matching whatever tool handlers publish under. */
  readonly name = input.required<string>();

  private readonly store = inject(RenderHandoffStore);

  /**
   * Consumed instances for this slot. We deliberately consume eagerly
   * (on first read after a handoff lands) so that page navigation away
   * + back doesn't re-mount stale components. The destination page is
   * the consumer; the chat panel never re-shows the same handoff.
   */
  protected readonly instances = computed(() => {
    // Read the slot map signal so we re-run when a new handoff lands.
    const map = this.store.slots();
    const items = map[this.name()] ?? ([] as readonly ComponentSpec[]);
    if (items.length === 0) return [];
    // Convert to AgenticWidgetInstance shape for <mvk-widget-container>.
    // Consume after a microtask so the computed completes before the
    // store mutation triggers a re-run (avoids a re-entrant signal
    // write-during-read).
    queueMicrotask(() => this.store.consume(this.name()));
    return items.map((spec, i) => ({
      widgetCallId: `slot:${this.name()}:${i}`,
      name: spec.name,
      props: spec.props,
    }));
  });
}
