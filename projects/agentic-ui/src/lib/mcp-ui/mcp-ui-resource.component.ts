import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  viewChild,
  effect,
} from '@angular/core';
import { DomSanitizer, type SafeHtml, type SafeResourceUrl } from '@angular/platform-browser';
import { MCP_UI_CONFIG } from './config';
import { McpUiActionBridge } from './mcp-ui-action-bridge';
import { McpUiComponentTreeComponent } from './mcp-ui-component-tree.component';
import {
  MCP_UI_COMPONENT_TREE_MIME,
  MCP_UI_HTML_MIME,
  MCP_UI_REMOTE_DOM_MIME,
  MCP_UI_URI_LIST_MIME,
  componentTreeNodeSchema,
  mcpUiResourceSchema,
  type ComponentTreeNode,
  type McpUiResource,
} from './types';

interface RenderPlan {
  readonly kind: 'srcdoc' | 'src' | 'component-tree' | 'unsupported' | 'blocked-origin' | 'invalid';
  readonly srcdoc?: SafeHtml;
  readonly src?: SafeResourceUrl;
  /** The external origin (for `src`); used to validate inbound postMessages. */
  readonly origin?: string;
  /** Parsed component tree (for `component-tree`). */
  readonly tree?: ComponentTreeNode;
  readonly reason?: string;
}

/**
 * Renders an MCP-UI `UIResource` in a sandboxed iframe (Phase 1 of the
 * MCP-UI + WebMCP plan). Two payload shapes ship in Phase 1:
 *
 *   - `text/html`     → `<iframe sandbox srcdoc="…">` (inline; origin 'null')
 *   - `text/uri-list` → `<iframe sandbox src="…">` (external; origin-allowlisted)
 *
 * `application/vnd.mcp-ui.remote-dom+javascript` is recognised but renders
 * an "unsupported" stub until Phase 3 (remote-dom → ComponentRegistry).
 *
 * Inbound actions: the iframe posts `{ source: 'mcp-ui', action }` messages;
 * this component forwards them to `McpUiActionBridge` with origin context.
 * The bridge validates + dispatches (tool calls go through the host's
 * scope policy). See ADR-049.
 */
@Component({
  selector: 'mvk-mcp-ui-resource',
  imports: [McpUiComponentTreeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let plan = renderPlan();
    @switch (plan.kind) {
      @case ('srcdoc') {
        <iframe
          #frame
          class="mcp-ui-frame"
          [attr.title]="resource().title ?? 'MCP UI resource'"
          [srcdoc]="plan.srcdoc"
        ></iframe>
      }
      @case ('src') {
        <iframe
          #frame
          class="mcp-ui-frame"
          [attr.title]="resource().title ?? 'MCP UI resource'"
          [src]="plan.src"
        ></iframe>
      }
      @case ('component-tree') {
        @if (plan.tree; as tree) {
          <mvk-mcp-ui-component-tree [node]="tree" />
        }
      }
      @case ('blocked-origin') {
        <div class="mcp-ui-stub mcp-ui-blocked">
          Blocked: <code>{{ resource().content }}</code> is not on the MCP-UI origin allowlist.
        </div>
      }
      @case ('unsupported') {
        <div class="mcp-ui-stub">
          Unsupported MCP-UI payload (<code>{{ resource().mimeType }}</code>).
          remote-dom (@remote-dom/core) isn't bundled — use
          <code>application/vnd.mcp-ui.component-tree+json</code> for native widget rendering.
        </div>
      }
      @default {
        <div class="mcp-ui-stub mcp-ui-invalid">Invalid MCP-UI resource.</div>
      }
    }
  `,
  styles: `
    :host { display: block; }
    .mcp-ui-frame { width: 100%; min-height: 240px; border: 1px solid var(--c-border, #d1d5db); border-radius: var(--r-md, 0.5rem); background: #fff; }
    .mcp-ui-stub { padding: 0.6rem 0.8rem; border-radius: 0.4rem; font-size: 0.85em; background: #fef3c7; color: #92400e; }
    .mcp-ui-blocked { background: #fee2e2; color: #991b1b; }
    .mcp-ui-invalid { background: #fee2e2; color: #991b1b; }
  `,
})
export class McpUiResourceComponent {
  readonly resource = input.required<McpUiResource>();
  private readonly frame = viewChild<ElementRef<HTMLIFrameElement>>('frame');

  private readonly sanitizer = inject(DomSanitizer);
  private readonly config = inject(MCP_UI_CONFIG);
  private readonly bridge = inject(McpUiActionBridge);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly renderPlan = computed<RenderPlan>(() => {
    const parsed = mcpUiResourceSchema.safeParse(this.resource());
    if (!parsed.success) return { kind: 'invalid', reason: 'schema' };
    const r = parsed.data;

    if (r.mimeType === MCP_UI_HTML_MIME) {
      return { kind: 'srcdoc', srcdoc: this.sanitizer.bypassSecurityTrustHtml(r.content) };
    }
    if (r.mimeType === MCP_UI_URI_LIST_MIME) {
      const url = r.content.trim().split(/\s+/)[0] ?? '';
      const origin = safeOrigin(url);
      if (!origin || !this.originAllowed(origin)) {
        return { kind: 'blocked-origin', reason: origin ?? 'unparseable-url' };
      }
      return {
        kind: 'src',
        src: this.sanitizer.bypassSecurityTrustResourceUrl(url),
        origin,
      };
    }
    if (r.mimeType === MCP_UI_COMPONENT_TREE_MIME) {
      // Parse the JSON component tree + validate against the recursive
      // schema. Rendered as native registered widgets — not an iframe.
      let raw: unknown;
      try {
        raw = JSON.parse(r.content);
      } catch {
        return { kind: 'invalid', reason: 'component-tree-json' };
      }
      const treeParsed = componentTreeNodeSchema.safeParse(raw);
      if (!treeParsed.success) return { kind: 'invalid', reason: 'component-tree-schema' };
      return { kind: 'component-tree', tree: treeParsed.data };
    }
    if (r.mimeType === MCP_UI_REMOTE_DOM_MIME) {
      return { kind: 'unsupported', reason: 'remote-dom' };
    }
    return { kind: 'invalid', reason: 'mime' };
  });

  constructor() {
    // Subscribe to postMessage only when a frame is actually rendered.
    // The listener is scoped to messages whose source is the frame's
    // contentWindow so a page with multiple resources doesn't cross-talk.
    effect((onCleanup) => {
      const plan = this.renderPlan();
      const frameRef = this.frame();
      if ((plan.kind !== 'srcdoc' && plan.kind !== 'src') || !frameRef) return;

      // `sandbox` must be a STATIC attribute on an <iframe> — Angular
      // refuses it as a binding (NG0910, security). Set it imperatively
      // here so it stays config-driven without tripping that guard.
      frameRef.nativeElement.setAttribute('sandbox', this.config.iframeSandbox);

      const expectedOrigin = plan.kind === 'src' ? (plan.origin ?? null) : null;
      const listener = (event: MessageEvent) => {
        // Only handle messages from THIS resource's frame.
        if (event.source !== frameRef.nativeElement.contentWindow) return;
        this.bridge.handleMessage({ data: event.data, origin: event.origin }, expectedOrigin);
      };
      globalThis.addEventListener('message', listener);
      onCleanup(() => globalThis.removeEventListener('message', listener));
    });
  }

  private originAllowed(origin: string): boolean {
    const list = this.config.allowedOrigins;
    return list.includes('*') || list.includes(origin);
  }
}

/** Parse an absolute URL's origin; returns null for relative / invalid URLs. */
function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
