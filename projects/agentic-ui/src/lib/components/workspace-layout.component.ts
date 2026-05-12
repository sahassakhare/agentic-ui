import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostBinding,
  Type,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { ComponentRegistry } from '../internal';
import type {
  ResponsiveCollapseRule,
  SlotDef,
  SlotMap,
} from '../layout/types';

/**
 * One slot resolved into a renderable component + Zod-validated inputs.
 */
interface ResolvedSlot {
  readonly name: string;
  readonly component: Type<unknown>;      // ComponentRegistry's component
  readonly inputs: Record<string, unknown>;
  readonly size: { default: string; min?: string; max?: string };
  readonly pinned: boolean;
  readonly open: 'inline' | 'modal' | 'drawer' | 'overlay';
}

/**
 * One slot that couldn't be resolved (unknown component name).
 * Renders inline as a warning instead of failing the whole layout.
 */
interface UnresolvedSlot {
  readonly name: string;
  readonly component: string;     // the unknown name
  readonly reason: 'unknown-component';
}

/**
 * Slot-based workspace layout — the runtime piece of ADR-043 D1 + D6.
 *
 * Renders an agent-emitted `SlotMap` as a flex layout. Each slot:
 *
 * - looks up its `component` in `ComponentRegistry`,
 * - Zod-validates its `props` against the component's schema (fails soft
 *   on mismatch — same pattern as `<mvk-widget-container>`),
 * - mounts via `*ngComponentOutlet` with the validated inputs.
 *
 * Honours `ResponsiveCollapseRule[]` at the supplied breakpoints via a
 * `ResizeObserver` on the host element. Below a breakpoint, listed
 * slots get `display:none` (collapse) or a drawer class (drawer mode).
 * Mobile/tablet aren't a separate app — they're a collapsed projection
 * of the same `SlotMap`.
 *
 * Slots requesting `open: 'modal' | 'drawer' | 'overlay'` render inline
 * with a `data-open="..."` attribute in slice 2; the real modal/drawer
 * surfaces are a follow-up slice (P1). Inline-only behaviour is the
 * back-compat default that doesn't regress existing flows.
 *
 * @see [ADR-043](../../../../docs/adr/0043-layout-registry-promotion.md)
 *
 * @example
 * ```html
 * <mvk-workspace-layout
 *   [slots]="{
 *     primary:  { component: 'documentPreview', size: { default: '60%' } },
 *     sidebar:  { component: 'tagPanel',        size: { default: '25%' } },
 *     footer:   { component: 'privilegeLog',    size: { default: '15%' } }
 *   }"
 *   [responsive]="[
 *     { belowPx: 1024, collapse: ['footer'], drawer: ['sidebar'] },
 *     { belowPx: 768,  collapse: ['sidebar', 'footer'], drawer: [] }
 *   ]"
 * />
 * ```
 */
@Component({
  selector: 'mvk-workspace-layout',
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (slot of visibleSlots(); track slot.name) {
      <section class="slot"
               [attr.data-slot]="slot.name"
               [attr.data-open]="slot.open"
               [attr.data-drawer]="isDrawer(slot.name) ? 'true' : null"
               [style.flex-basis]="slot.size.default"
               [style.min-width]="slot.size.min ?? null"
               [style.max-width]="slot.size.max ?? null">
        <ng-container *ngComponentOutlet="slot.component; inputs: slot.inputs" />
      </section>
    }
    @for (slot of unresolvedSlots(); track slot.name) {
      <section class="slot slot-unresolved" [attr.data-slot]="slot.name">
        Unknown component "{{ slot.component }}" in slot "{{ slot.name }}".
      </section>
    }
  `,
  styles: `
    :host { display: flex; gap: 0.5rem; align-items: stretch; height: 100%; min-height: 0; }
    .slot { flex: 1 1 auto; min-width: 0; min-height: 0; overflow: auto; }
    .slot[data-drawer="true"] {
      position: absolute; right: 0; top: 0; height: 100%;
      background: white; box-shadow: -2px 0 8px rgba(0,0,0,0.08);
      transform: translateX(100%); transition: transform 200ms ease-out;
      z-index: 10;
    }
    .slot[data-drawer="true"]:focus-within { transform: translateX(0); }
    .slot-unresolved { padding: 0.6rem 0.8rem; background: #fef3c7; color: #92400e; border-radius: 0.4rem; font-size: 0.85em; }
  `,
})
export class WorkspaceLayoutComponent {
  /** The slot-name → slot-content map. Required. */
  readonly slots = input.required<SlotMap>();

  /** Optional responsive collapse rules; consulted at every host-width change. */
  readonly responsive = input<readonly ResponsiveCollapseRule[]>([]);

  /**
   * Optional named layout. Slice 2 only attaches it as a host attribute for
   * CSS targeting; full registry lookup + outer-shell projection lands in
   * slice 3 once the LAYOUT_RENDER event mapper is wired.
   */
  readonly layoutName = input<string | undefined>(undefined);

  private readonly registry = inject(ComponentRegistry);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  /** Current host width in CSS pixels; drives responsive collapse evaluation. */
  private readonly hostWidthPx = signal<number>(
    typeof window === 'undefined' ? Infinity : window.innerWidth,
  );

  constructor() {
    // ResizeObserver tracks the host's content-box width so the responsive
    // rules apply against the *container*, not the viewport. Makes the
    // component work inside a side rail / drawer / split pane without the
    // collapse rules misfiring against the outer page width.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const width = entry.contentRect.width;
      // Update on a microtask to avoid the "ResizeObserver loop limit
      // exceeded" warning that fires when synchronous signal writes
      // re-trigger layout in the same frame.
      queueMicrotask(() => this.hostWidthPx.set(width));
    });
    observer.observe(this.host.nativeElement);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  /**
   * The active responsive rule (or null when none applies). The rule with
   * the *smallest* `belowPx` greater than the current width wins — most-
   * restrictive first — so a 600px host honours both the `< 768` and
   * `< 1024` rules' union, but applies the tightest collapse set.
   */
  private readonly activeRule = computed<ResponsiveCollapseRule | null>(() => {
    const width = this.hostWidthPx();
    const applicable = this.responsive().filter((r) => width < r.belowPx);
    if (applicable.length === 0) return null;
    // Smallest breakpoint wins — that's the tightest collapse set.
    return applicable.reduce((a, b) => (a.belowPx <= b.belowPx ? a : b));
  });

  /** Slots that should currently render (after responsive collapse). */
  protected readonly visibleSlots = computed<ResolvedSlot[]>(() => {
    const rule = this.activeRule();
    const collapsed = new Set(rule?.collapse ?? []);
    const out: ResolvedSlot[] = [];
    for (const [name, def] of Object.entries(this.slots())) {
      if (collapsed.has(name) && !def.pinned) continue;
      const resolved = this.resolveSlot(name, def);
      if (resolved) out.push(resolved);
    }
    return out;
  });

  /** Slots whose component name isn't in the registry — surface as warnings. */
  protected readonly unresolvedSlots = computed<UnresolvedSlot[]>(() => {
    const rule = this.activeRule();
    const collapsed = new Set(rule?.collapse ?? []);
    const out: UnresolvedSlot[] = [];
    for (const [name, def] of Object.entries(this.slots())) {
      if (collapsed.has(name) && !def.pinned) continue;
      if (!this.registry.get(def.component)) {
        out.push({ name, component: def.component, reason: 'unknown-component' });
      }
    }
    return out;
  });

  /** True iff this slot is in the active rule's drawer list. */
  protected isDrawer(slotName: string): boolean {
    return (this.activeRule()?.drawer ?? []).includes(slotName);
  }

  /** Mirror the optional layoutName onto the host for CSS targeting. */
  @HostBinding('attr.data-layout-name')
  get hostLayoutName(): string | null {
    return this.layoutName() ?? null;
  }

  /** Warn once per unresolved slot — same fail-soft contract as widget-container. */
  private readonly warnSink = effect(() => {
    const list = this.unresolvedSlots();
    if (list.length === 0) return;
    for (const u of list) {
      // eslint-disable-next-line no-console
      console.warn(
        `[mvk-workspace-layout] Unknown component "${u.component}" in slot "${u.name}". ` +
          `Register it via ComponentRegistry.register({...}) before emitting this LayoutDef.`,
      );
    }
  });

  private resolveSlot(name: string, def: SlotDef): ResolvedSlot | null {
    const componentDef = this.registry.get(def.component);
    if (!componentDef) return null;     // surfaces via unresolvedSlots()

    // Zod-validate props against the component's schema. Failures fall
    // through to the raw props (matching <mvk-widget-container>'s pattern)
    // so a single bad prop doesn't fail the whole layout.
    const parsed = componentDef.propsSchema.safeParse(def.props ?? {});
    const inputs = (parsed.success ? parsed.data : (def.props ?? {})) as Record<string, unknown>;

    return {
      name,
      component: componentDef.component as Type<unknown>,
      inputs,
      size: def.size ?? { default: 'auto' },
      pinned: def.pinned ?? false,
      open: def.open ?? 'inline',
    };
  }
}
