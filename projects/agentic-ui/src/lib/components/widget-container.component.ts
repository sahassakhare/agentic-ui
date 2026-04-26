import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ComponentRegistry, type AgenticWidgetInstance } from '../internal';

interface ResolvedWidget {
  readonly component: ReturnType<ComponentRegistry['get']> extends infer T
    ? T extends { component: infer C } ? C : null
    : null;
  readonly inputs: Record<string, unknown>;
}

/**
 * Renders an agent-emitted widget by resolving its component from the
 * `ComponentRegistry` and applying validated props as Angular inputs via
 * `*ngComponentOutlet`. Mirrors flights42's `widget-container.ts`.
 */
@Component({
  selector: 'mvk-widget-container',
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (resolved(); as r) {
      <ng-container *ngComponentOutlet="r.component; inputs: r.inputs" />
    } @else {
      <div class="unresolved">Unknown widget: {{ widget().name }}</div>
    }
  `,
  styles: `
    :host { display: block; }
    .unresolved { padding: 0.4rem 0.6rem; background: #fef3c7; color: #92400e; border-radius: 0.4rem; font-size: 0.85em; }
  `,
})
export class WidgetContainerComponent {
  readonly widget = input.required<AgenticWidgetInstance>();
  private readonly registry = inject(ComponentRegistry);

  protected readonly resolved = computed<ResolvedWidget | null>(() => {
    const w = this.widget();
    const def = this.registry.get(w.name);
    if (!def) return null;
    const parsed = def.propsSchema.safeParse(w.props);
    const inputs = (parsed.success ? parsed.data : w.props) as Record<string, unknown>;
    return { component: def.component as ResolvedWidget['component'], inputs };
  });
}
