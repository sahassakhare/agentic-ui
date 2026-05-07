import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ComponentRegistry, DataSourceRegistry, type AgenticWidgetInstance } from '../internal';

interface ResolvedWidget {
  readonly component: ReturnType<ComponentRegistry['get']> extends infer T
    ? T extends { component: infer C } ? C : null
    : null;
  readonly inputs: Record<string, unknown>;
}

interface UnresolvedWidget {
  readonly reason: 'unknown-widget' | 'missing-data-sources';
  readonly name: string;
  readonly missingSources?: readonly string[];
}

/**
 * Renders an agent-emitted widget by resolving its component from the
 * `ComponentRegistry`, validating that every declared `dataSources`
 * entry resolves to a registered `DataSourceRegistry` source
 * (Capability F2), and applying validated props as Angular inputs via
 * `*ngComponentOutlet`. Mirrors flights42's `widget-container.ts`.
 */
@Component({
  selector: 'mvk-widget-container',
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (resolved(); as r) {
      <ng-container *ngComponentOutlet="r.component; inputs: r.inputs" />
    } @else if (unresolved(); as u) {
      @if (u.reason === 'missing-data-sources') {
        <div class="unresolved">
          Widget "{{ u.name }}" is missing required data sources:
          {{ u.missingSources?.join(', ') }}
        </div>
      } @else {
        <div class="unresolved">Unknown widget: {{ u.name }}</div>
      }
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
  private readonly dataSources = inject(DataSourceRegistry);

  protected readonly resolved = computed<ResolvedWidget | null>(() => {
    const w = this.widget();
    const def = this.registry.get(w.name);
    if (!def) return null;
    if (def.dataSources && def.dataSources.length > 0) {
      const missing = this.dataSources.missing(def.dataSources);
      if (missing.length > 0) return null;
    }
    const parsed = def.propsSchema.safeParse(w.props);
    const inputs = (parsed.success ? parsed.data : w.props) as Record<string, unknown>;
    return { component: def.component as ResolvedWidget['component'], inputs };
  });

  protected readonly unresolved = computed<UnresolvedWidget | null>(() => {
    const w = this.widget();
    const def = this.registry.get(w.name);
    if (!def) return { reason: 'unknown-widget', name: w.name };
    if (def.dataSources && def.dataSources.length > 0) {
      const missing = this.dataSources.missing(def.dataSources);
      if (missing.length > 0) {
        return { reason: 'missing-data-sources', name: w.name, missingSources: missing };
      }
    }
    return null;
  });
}
