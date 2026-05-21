import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { ComponentRegistry } from '../registries/component-registry';
import { AGENTIC_TELEMETRY_SINK } from '../telemetry/telemetry-sink';
import type { ComponentTreeNode } from './types';

interface ResolvedNode {
  readonly component: ReturnType<ComponentRegistry['get']> extends infer T
    ? T extends { component: infer C } ? C : null
    : null;
  readonly inputs: Record<string, unknown>;
  readonly children: readonly ComponentTreeNode[];
}

/**
 * Renders a server-described component tree as the host's OWN registered
 * `ComponentRegistry` widgets (Phase 3 of the MCP-UI plan — the
 * "server-driven native UI" feature). Each node's `component` is a
 * registered widget name; `props` are validated against the widget's
 * propsSchema; `children` render recursively beneath.
 *
 * Unlike `<mvk-mcp-ui-resource>`'s iframe path, this renders in-process
 * as native Angular components — full styling, full interactivity, the
 * host's own design system. The trade-off: the server can only compose
 * widgets the host has REGISTERED (unknown names render a stub), which
 * is exactly the trust boundary you want — a server can't inject
 * arbitrary markup, only arrange your vetted components.
 */
@Component({
  selector: 'mvk-mcp-ui-component-tree',
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let r = resolved();
    @if (r && r.component) {
      <ng-container *ngComponentOutlet="r.component; inputs: r.inputs" />
      @if (r.children.length > 0) {
        <div class="mcp-ui-tree-children">
          @for (child of r.children; track $index) {
            <mvk-mcp-ui-component-tree [node]="child" />
          }
        </div>
      }
    } @else {
      <div class="mcp-ui-tree-unknown">Unknown widget: {{ node().component }}</div>
    }
  `,
  styles: `
    :host { display: block; }
    .mcp-ui-tree-children { display: flex; flex-direction: column; gap: 0.5rem; }
    .mcp-ui-tree-unknown { padding: 0.4rem 0.6rem; background: #fef3c7; color: #92400e; border-radius: 0.4rem; font-size: 0.85em; }
  `,
})
export class McpUiComponentTreeComponent {
  readonly node = input.required<ComponentTreeNode>();
  private readonly registry = inject(ComponentRegistry);
  private readonly telemetry = inject(AGENTIC_TELEMETRY_SINK);

  protected readonly resolved = computed<ResolvedNode | null>(() => {
    const n = this.node();
    const def = this.registry.get(n.component);
    if (!def) {
      // Telemetry once per unresolved node so adopters can see which
      // server-requested widgets aren't registered.
      this.telemetry.emit('agentic.widget.render', {
        'agentic.widget.name': n.component,
        'agentic.widget.source': 'mcp-ui-component-tree',
        'agentic.widget.props_parse': 'unknown-widget',
      });
      return { component: null as never, inputs: {}, children: n.children ?? [] };
    }
    const parsed = def.propsSchema.safeParse(n.props ?? {});
    const inputs = (parsed.success ? parsed.data : (n.props ?? {})) as Record<string, unknown>;
    this.telemetry.emit('agentic.widget.render', {
      'agentic.widget.name': n.component,
      'agentic.widget.source': 'mcp-ui-component-tree',
      'agentic.widget.props_parse': parsed.success ? 'ok' : 'fallthrough',
    });
    return {
      component: def.component as ResolvedNode['component'],
      inputs,
      children: n.children ?? [],
    };
  });
}
