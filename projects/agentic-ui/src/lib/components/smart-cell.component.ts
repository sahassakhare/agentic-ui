import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Type,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { ComponentRegistry } from '../registries/component-registry';
import { ToolRegistry } from '../registries/tool-registry';

interface ResolvedRender {
  readonly component: Type<unknown>;
  readonly inputs: Record<string, unknown>;
}

/**
 * Agent-computed table cell — Pillar 1 pattern 1 of
 * [post-chat-surfaces-plan.md](../../../../docs/plans/post-chat-surfaces-plan.md).
 *
 * Wraps a tool-computed value as a single cell with optional persona-
 * scoped visibility and an optional hover-explanation widget. The value
 * itself is host-driven — the host wires the data flow (signal, resource,
 * resolver, async pipe, whatever) and passes the latest snapshot via
 * `[value]` / `[loading]` / `[error]`. That keeps the cell decoupled from
 * any specific data-fetching mechanism.
 *
 * Cell rendering layers:
 *
 * - **Persona-blocked.** When `[tool]` is set and the active persona can't
 *   see that tool via `ToolRegistry.get()` (which applies `setScopePolicy`),
 *   the cell renders an em-dash placeholder — never the underlying value.
 * - **Loading.** When `[loading]="true"`, an unobtrusive `…` placeholder
 *   (with `aria-busy="true"`) so screen readers don't read stale values.
 * - **Error.** When `[error]` is a string, an `✗` badge with the message
 *   in `title` — readers and hover surfaces see the cause without the
 *   cell exploding.
 * - **Widget.** When `[widget]` names a registered `ComponentRegistry`
 *   entry, the value is rendered via `*ngComponentOutlet` with
 *   `{ value }` as the bound inputs. Zod-validate inputs against the
 *   component's schema; failures fall through to raw inputs.
 * - **Plain text fallback.** No widget → the value is stringified
 *   directly into the cell's text node.
 *
 * **Hover explainability.** When `[hoverWidget]` is set, hovering /
 * focusing / tap-pressing the cell reveals the named widget below it,
 * receiving the same `value` as input. Typical use: a `<privilege-
 * confidence-cell>` value with a `<privilege-confidence-detail>`
 * hoverWidget that lists the matched phrases + sender attribution.
 *
 * Persona scope + audit: the optional `[tool]` is the canonical hook
 * to mark *which* tool computed the value. Hosts use it for audit
 * attribution (every cell render is a chain-hashed tool call) and the
 * lib uses it for persona filtering.
 *
 * @example
 * ```html
 * <mvk-smart-cell
 *   [value]="row.privilegeConfidence"
 *   [loading]="row.classificationLoading"
 *   widget="privilegeConfidence"
 *   hoverWidget="privilegeConfidenceDetail"
 *   tool="runTARClassifier" />
 * ```
 */
@Component({
  selector: 'mvk-smart-cell',
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (personaBlocked()) {
      <span class="blocked" aria-hidden="true">—</span>
    } @else if (loading()) {
      <span class="loading" aria-busy="true">…</span>
    } @else if (error(); as e) {
      <span class="error" [attr.title]="e" role="img" aria-label="Error">✗</span>
    } @else if (valueRender(); as r) {
      <span class="value"
            tabindex="0"
            (mouseenter)="onHover(true)"
            (mouseleave)="onHover(false)"
            (focus)="onHover(true)"
            (blur)="onHover(false)"
            (click)="onTap()">
        <ng-container *ngComponentOutlet="r.component; inputs: r.inputs" />
      </span>
    } @else {
      <span class="value text"
            tabindex="0"
            (mouseenter)="onHover(true)"
            (mouseleave)="onHover(false)"
            (focus)="onHover(true)"
            (blur)="onHover(false)"
            (click)="onTap()">{{ valueText() }}</span>
    }

    @if (showDetail() && hoverRender(); as h) {
      <div class="detail" role="tooltip">
        <ng-container *ngComponentOutlet="h.component; inputs: h.inputs" />
      </div>
    }
  `,
  styles: `
    :host { display: inline-block; position: relative; }
    .blocked { color: #d1d5db; user-select: none; }
    .loading { color: #6b7280; }
    .error { color: #b91c1c; cursor: help; }
    .value { display: inline-flex; align-items: center; cursor: pointer; outline: 0; }
    .value:focus-visible { outline: 2px solid #6366f1; outline-offset: 2px; border-radius: 0.2rem; }
    .text { color: inherit; }
    .detail {
      position: absolute; left: 0; top: 100%; margin-top: 0.25rem;
      background: white; border: 1px solid #e5e7eb; border-radius: 0.4rem;
      box-shadow: 0 4px 16px rgba(15, 23, 42, 0.12);
      padding: 0.4rem 0.6rem; min-width: 240px; max-width: 360px;
      z-index: 20; font-size: 0.85em; line-height: 1.4;
    }
  `,
})
export class SmartCellComponent {
  /** The value the cell renders. Host wires the data flow. */
  readonly value = input<unknown>(undefined);
  /** True when the underlying compute is in flight. */
  readonly loading = input<boolean>(false);
  /** Non-empty when the compute failed; surfaced as a `✗` with title text. */
  readonly error = input<string | undefined>(undefined);
  /**
   * Optional `ComponentRegistry` name. When present, the cell renders
   * via `*ngComponentOutlet` with `{ value }` as inputs (Zod-validated
   * against the component's schema; failures fall through to raw inputs).
   */
  readonly widget = input<string | undefined>(undefined);
  /**
   * Optional `ComponentRegistry` name for the hover explainability
   * widget. Receives `{ value }` as inputs. Shown on hover, focus, or
   * tap.
   */
  readonly hoverWidget = input<string | undefined>(undefined);
  /**
   * Optional tool name. Two effects:
   * - persona scope: if the active persona can't see this tool via
   *   `ToolRegistry.get()`, the cell renders an em-dash placeholder.
   * - audit attribution: hosts read this attribute when assembling
   *   audit-chain entries to mark *which* tool computed the value.
   */
  readonly tool = input<string | undefined>(undefined);

  protected readonly showDetail = signal(false);

  private readonly components = inject(ComponentRegistry);
  private readonly tools = inject(ToolRegistry);

  /**
   * True iff `[tool]` is set AND the active persona can't see it via
   * the scope-filtered `ToolRegistry.get()`. Drives the em-dash render.
   */
  protected readonly personaBlocked = computed(() => {
    const name = this.tool();
    if (!name) return false;
    return this.tools.get(name) === undefined;
  });

  /** Resolved widget for the main value render (null if no widget). */
  protected readonly valueRender = computed<ResolvedRender | null>(() => {
    const name = this.widget();
    if (!name) return null;
    return this.resolveWidget(name);
  });

  /** Resolved widget for the hover detail render (null if no hoverWidget). */
  protected readonly hoverRender = computed<ResolvedRender | null>(() => {
    const name = this.hoverWidget();
    if (!name) return null;
    return this.resolveWidget(name);
  });

  /** Plain-text fallback when no widget is provided. */
  protected readonly valueText = computed<string>(() => {
    const v = this.value();
    if (v === undefined || v === null) return '';
    if (typeof v === 'object') {
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    }
    return String(v);
  });

  protected onHover(active: boolean): void {
    if (!this.hoverWidget()) return;
    this.showDetail.set(active);
  }

  protected onTap(): void {
    if (!this.hoverWidget()) return;
    // Touch surfaces: tap toggles the detail. Hover handlers cover desktop.
    this.showDetail.update((v) => !v);
  }

  private resolveWidget(name: string): ResolvedRender | null {
    const def = this.components.get(name);
    if (!def) return null;
    const candidateInputs = { value: this.value() };
    const parsed = def.propsSchema.safeParse(candidateInputs);
    const inputs = (parsed.success ? parsed.data : candidateInputs) as Record<string, unknown>;
    return { component: def.component as Type<unknown>, inputs };
  }
}
