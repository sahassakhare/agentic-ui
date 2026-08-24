import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  type Type,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  AGENTIC_TELEMETRY_SINK,
  ActionRegistry,
  COMPOSITION_SLOT,
  ComponentRegistry,
  CompositionStore,
  DataSourceRegistry,
  FormRegistry,
  ToolRegistry,
  ValidationRegistry,
  type ActionContext,
  type CompositionEntry,
  type FormActionDef,
  type FormDef,
  type FormFieldUi,
  type ToolContext,
} from '../internal';

interface FieldDescriptor {
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
  readonly ui: FormFieldUi;
}

interface ResolvedSection {
  readonly entry: CompositionEntry;
  readonly component: Type<unknown> | null;
  readonly pendingDrop: boolean;
  readonly keepOverride: boolean;
  /**
   * Per-section injector providing `COMPOSITION_SLOT` so opted-in widgets
   * can `inject(COMPOSITION_SLOT, { optional: true })` to learn their
   * slot key without needing a public input.
   */
  readonly injector: Injector;
  /**
   * Names from `ComponentDef.dataSources` (Capability F2) that did NOT
   * resolve at the moment this section was prepared. Non-empty disables
   * widget mounting and surfaces an inline diagnostic so authoring
   * errors surface at mount, not at first call.
   */
  readonly missingDataSources: readonly string[];
}

/**
 * Renders a schema-driven or runtime-composed form by name, validates input
 * via the configured `ValidationRegistry`, and invokes the `FormDef.submit`
 * handler on success.
 *
 * Inputs:
 *  - `formName` — name of a form registered with `FormRegistry`.
 *  - `initialValues?` — optional pre-filled values from the agent.
 *  - `context?` — composition context for runtime-composed forms (Capability
 *     F1). Each composition entry's `predicate` is evaluated against this
 *     context — typically `{ matter, persona, ... }`. Changing the input
 *     re-evaluates predicates and toggles sections (AC-F1-1).
 *
 * Composition mode also provides per-instance `CompositionStore` so widgets
 * can read/write values that survive section unmount (AC-F1-2). When a
 * predicate flips visible→hidden on a dirty slot, the section stays mounted
 * and an inline banner asks the user to drop the values or keep the section.
 */
@Component({
  selector: 'mvk-form-renderer',
  imports: [FormsModule, NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [CompositionStore],
  template: `
    @if (form(); as f) {
      @if (f.composition) {
        <form (submit)="$event.preventDefault(); onSubmit()">
          <h3>{{ f.name }}</h3>
          @if (f.description) { <p class="desc">{{ f.description }}</p> }
          @for (sec of visibleSections(); track sec.entry.widget) {
            <section class="composition-section">
              @if (sec.entry.section) {
                <h4 class="section-heading">{{ sec.entry.section }}</h4>
              }
              @if (sec.pendingDrop) {
                <div class="drop-banner" role="alert">
                  <p>This section no longer applies in the new context. Drop your entries, or keep the section visible?</p>
                  <div class="drop-actions">
                    <button type="button" class="danger" (click)="dropSection(sec.entry.widget)">Drop values</button>
                    <button type="button" (click)="keepSection(sec.entry.widget)">Keep visible</button>
                  </div>
                </div>
              } @else if (sec.keepOverride) {
                <p class="keep-hint">Section kept open after context change.</p>
              }
              @if (sec.component) {
                <ng-container *ngComponentOutlet="sec.component; injector: sec.injector" />
              } @else if (sec.missingDataSources.length > 0) {
                <p class="missing">
                  Widget "{{ sec.entry.widget }}" is missing required data sources:
                  {{ sec.missingDataSources.join(', ') }}
                </p>
              } @else {
                <p class="missing">Unknown widget: {{ sec.entry.widget }}</p>
              }
            </section>
          }
          <div class="form-actions">
            @for (a of actions(); track $index) {
              <button
                [attr.type]="a.kind === 'submit' ? 'submit' : 'button'"
                [class.secondary]="a.style === 'secondary'"
                [class.danger]="a.style === 'danger'"
                [disabled]="a.kind === 'submit' && submitting()"
                (click)="a.kind !== 'submit' && runAction(a)">
                {{ a.kind === 'submit' && submitting() ? 'Submitting…' : a.label }}
              </button>
            }
            <ng-content select="[formActions]" />
          </div>
        </form>
      } @else {
        <form (submit)="$event.preventDefault(); onSubmit()">
          <h3>{{ f.name }}</h3>
          @if (f.description) { <p class="desc">{{ f.description }}</p> }
          @for (field of fields(); track field.key) {
            @if (field.ui.widget === 'radio') {
              <fieldset class="field-radio">
                <legend>{{ field.label }}@if (field.required) { <em aria-hidden="true">*</em> }</legend>
                <span class="radio-group">
                  @for (opt of field.ui.options ?? []; track opt.value) {
                    <label class="radio">
                      <input type="radio"
                        [name]="field.key"
                        [value]="opt.value"
                        [ngModel]="readField(field.key)"
                        (ngModelChange)="writeField(field.key, $event)"
                        [attr.aria-required]="field.required || null" />
                      <span>{{ opt.label }}</span>
                    </label>
                  }
                </span>
                @if (errorFor(field.key); as err) { <small class="error" role="alert">{{ err }}</small> }
              </fieldset>
            } @else {
            <label>
              <span>{{ field.label }}@if (field.required) { <em aria-hidden="true">*</em> }</span>
              @switch (field.ui.widget) {
                @case ('textarea') {
                  <textarea
                    [ngModel]="readField(field.key)"
                    (ngModelChange)="writeField(field.key, $event)"
                    [name]="field.key"
                    [placeholder]="field.ui.placeholder ?? ''"
                    [attr.aria-required]="field.required || null"
                    [attr.aria-invalid]="!!errorFor(field.key) || null"></textarea>
                }
                @case ('select') {
                  <select
                    [ngModel]="readField(field.key)"
                    (ngModelChange)="writeField(field.key, $event)"
                    [name]="field.key"
                    [attr.aria-required]="field.required || null"
                    [attr.aria-invalid]="!!errorFor(field.key) || null">
                    @if (!field.required) { <option [ngValue]="undefined">—</option> }
                    @for (opt of field.ui.options ?? []; track opt.value) {
                      <option [value]="opt.value">{{ opt.label }}</option>
                    }
                  </select>
                }
                @case ('checkbox') {
                  <input type="checkbox"
                    [ngModel]="!!readField(field.key)"
                    (ngModelChange)="writeField(field.key, $event)"
                    [name]="field.key"
                    [attr.aria-required]="field.required || null" />
                }
                @case ('number') {
                  <input type="number"
                    [ngModel]="readField(field.key)"
                    (ngModelChange)="writeField(field.key, +$event)"
                    [name]="field.key"
                    [placeholder]="field.ui.placeholder ?? ''"
                    [attr.aria-required]="field.required || null"
                    [attr.aria-invalid]="!!errorFor(field.key) || null" />
                }
                @case ('range') {
                  <span class="range-row">
                    <input type="range"
                      [ngModel]="readField(field.key)"
                      (ngModelChange)="writeField(field.key, +$event)"
                      [name]="field.key"
                      [attr.aria-required]="field.required || null" />
                    <output class="range-out">{{ readField(field.key) ?? 0 }}</output>
                  </span>
                }
                @case ('date') {
                  <input type="date"
                    [ngModel]="readField(field.key)"
                    (ngModelChange)="writeField(field.key, $event)"
                    [name]="field.key"
                    [attr.aria-required]="field.required || null"
                    [attr.aria-invalid]="!!errorFor(field.key) || null" />
                }
                @case ('time') {
                  <input type="time"
                    [ngModel]="readField(field.key)"
                    (ngModelChange)="writeField(field.key, $event)"
                    [name]="field.key"
                    [attr.aria-required]="field.required || null"
                    [attr.aria-invalid]="!!errorFor(field.key) || null" />
                }
                @default {
                  <input [type]="inputType(field.ui.widget)"
                    [ngModel]="readField(field.key)"
                    (ngModelChange)="writeField(field.key, $event)"
                    [name]="field.key"
                    [placeholder]="field.ui.placeholder ?? ''"
                    [attr.aria-required]="field.required || null"
                    [attr.aria-invalid]="!!errorFor(field.key) || null" />
                }
              }
              @if (errorFor(field.key); as err) {
                <small class="error" role="alert">{{ err }}</small>
              }
            </label>
            }
          }
          <div class="form-actions">
            @for (a of actions(); track $index) {
              <button
                [attr.type]="a.kind === 'submit' ? 'submit' : 'button'"
                [class.secondary]="a.style === 'secondary'"
                [class.danger]="a.style === 'danger'"
                [disabled]="a.kind === 'submit' && submitting()"
                (click)="a.kind !== 'submit' && runAction(a)">
                {{ a.kind === 'submit' && submitting() ? 'Submitting…' : a.label }}
              </button>
            }
            <ng-content select="[formActions]" />
          </div>
        </form>
      }
    } @else {
      <p class="missing">Form "{{ formName() }}" is not registered.</p>
    }
  `,
  styles: `
    :host { display: block; padding: 0.5rem; }
    form { display: flex; flex-direction: column; gap: 0.6rem; }
    h3 { margin: 0; font-size: 1rem; }
    .desc { margin: 0; color: var(--text-muted, #6b7280); font-size: 0.85rem; }
    label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; }
    label em { color: #b91c1c; font-style: normal; margin-left: 0.15rem; }
    .field-radio { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.3rem; }
    .field-radio legend { padding: 0; font-size: 0.85rem; }
    .field-radio legend em { color: #b91c1c; font-style: normal; margin-left: 0.15rem; }
    .radio-group { display: flex; flex-wrap: wrap; gap: 0.75rem; }
    .radio { display: inline-flex; flex-direction: row; align-items: center; gap: 0.3rem; font-size: 0.85rem; }
    .range-row { display: flex; align-items: center; gap: 0.5rem; }
    .range-row input[type=range] { flex: 1; }
    .range-out { font-variant-numeric: tabular-nums; color: var(--text-muted, #6b7280); min-width: 2ch; text-align: right; }
    input, select, textarea { padding: 0.4rem 0.5rem; border: 1px solid var(--border, #d1d5db); border-radius: 0.3rem; font: inherit; }
    .error { color: #b91c1c; font-size: 0.75rem; }
    .form-actions { display: flex; align-items: center; gap: 0.5rem; }
    button { padding: 0.5rem 1rem; background: var(--brand, #2563eb); color: var(--on-brand, #fff); border: 0; border-radius: 0.3rem; cursor: pointer; align-self: flex-start; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    button.danger { background: var(--danger, #dc2626); }
    button.secondary { background: #4b5563; }
    .missing { padding: 0.4rem; background: var(--warn-soft, #fef3c7); color: var(--warn, #92400e); border-radius: 0.3rem; font-size: 0.85rem; }
    .composition-section { display: flex; flex-direction: column; gap: 0.4rem; padding-bottom: 0.4rem; border-bottom: 1px solid #f3f4f6; }
    .composition-section:last-of-type { border-bottom: 0; }
    .section-heading { margin: 0; font-size: 0.85rem; font-weight: 600; color: #374151; text-transform: uppercase; letter-spacing: 0.04em; }
    .drop-banner { padding: 0.5rem 0.7rem; background: #fef3c7; color: #78350f; border: 1px solid #fde68a; border-radius: 0.4rem; font-size: 0.85rem; }
    .drop-banner p { margin: 0 0 0.4rem; line-height: 1.3; }
    .drop-actions { display: flex; gap: 0.4rem; }
    .drop-actions button { padding: 0.3rem 0.7rem; font-size: 0.8rem; align-self: flex-start; }
    .drop-actions button:not(.danger) { background: #4b5563; }
    .keep-hint { margin: 0; padding: 0.3rem 0.5rem; background: #eff6ff; color: #1e40af; border-radius: 0.3rem; font-size: 0.78rem; }
  `,
})
export class FormRendererComponent {
  readonly formName = input.required<string>();
  readonly initialValues = input<Readonly<Record<string, unknown>>>({});
  readonly context = input<Readonly<Record<string, unknown>>>({});

  /**
   * Emitted by `emit`- and `cancel`-kind action buttons so the host can react
   * (e.g. close a drawer, route back). `event` is the action's `event` name
   * (`'cancel'` for cancel buttons); `detail` carries the author's payload.
   */
  readonly formAction = output<{ readonly event: string; readonly detail?: Record<string, unknown> }>();

  private readonly forms = inject(FormRegistry);
  private readonly validators = inject(ValidationRegistry);
  private readonly components = inject(ComponentRegistry);
  private readonly dataSources = inject(DataSourceRegistry);
  private readonly tools = inject(ToolRegistry);
  private readonly actionsRegistry = inject(ActionRegistry);
  // Optional so the renderer works in tests / SSR without a router.
  private readonly router = inject(Router, { optional: true });
  private readonly store = inject(CompositionStore);
  private readonly hostInjector = inject(Injector);
  private readonly telemetry = inject(AGENTIC_TELEMETRY_SINK);
  private actionSeq = 0;

  /**
   * Cached per-slot injectors keyed by slot name. Created lazily and
   * carried across context changes — the slot value never changes for a
   * given entry, so the same injector can be reused as the section
   * remounts on toggle.
   */
  private readonly slotInjectors = new Map<string, Injector>();

  private slotInjectorFor(slot: string): Injector {
    let inj = this.slotInjectors.get(slot);
    if (!inj) {
      inj = Injector.create({
        providers: [{ provide: COMPOSITION_SLOT, useValue: slot }],
        parent: this.hostInjector,
      });
      this.slotInjectors.set(slot, inj);
    }
    return inj;
  }

  protected readonly form = computed<FormDef | undefined>(() => this.forms.get(this.formName()));

  /**
   * The action bar to render. Factory-built forms always carry `actions`;
   * a hand-built `FormDef` that omits them falls back to a single Submit so
   * the classic single-submit UI is preserved.
   */
  protected readonly actions = computed<readonly FormActionDef[]>(
    () => this.form()?.actions ?? [{ kind: 'submit', label: 'Submit' }],
  );

  private readonly values = signal<Record<string, unknown>>({});
  private readonly errors = signal<Record<string, string>>({});
  protected readonly submitting = signal(false);

  /** Slots whose drop-vs-keep decision is awaiting user confirmation. */
  private readonly pendingPrompts = signal<ReadonlySet<string>>(new Set());

  /** Slots the user explicitly chose to keep visible after a predicate flip. */
  private readonly keepOverrides = signal<ReadonlySet<string>>(new Set());

  protected readonly fields = computed<FieldDescriptor[]>(() => {
    const def = this.form();
    if (!def) return [];
    const shape = (def.fieldsSchema as { shape?: Record<string, unknown> }).shape;
    if (!shape) return [];
    return Object.keys(shape).map((key) => {
      const ui = def.ui?.[key] ?? {};
      const required = !(shape[key] as { isOptional?: () => boolean }).isOptional?.();
      return { key, label: prettyLabel(key), required, ui };
    }).sort((a, b) => (a.ui.order ?? 0) - (b.ui.order ?? 0));
  });

  /**
   * Composition entries to render, factoring in:
   *   - the entry's predicate against `context()`
   *   - any pending drop prompt (forces visibility while user decides)
   *   - any user "keep visible" override
   *
   * Recomputes when `form()`, `context()`, `pendingPrompts()`, or
   * `keepOverrides()` change.
   */
  protected readonly visibleSections = computed<readonly ResolvedSection[]>(() => {
    const def = this.form();
    if (!def?.composition) return [];
    const ctx = this.context();
    const pending = this.pendingPrompts();
    const keeps = this.keepOverrides();
    const start = performance.now();
    const totalEntries = def.composition.length;

    const sections: ResolvedSection[] = [];
    for (const entry of def.composition) {
      const slot = entry.widget;
      const ok = entry.predicate ? entry.predicate(ctx) : true;
      const visible = ok || pending.has(slot) || keeps.has(slot);
      if (!visible) continue;
      const widgetDef = this.components.get(slot);
      const missingDataSources = widgetDef?.dataSources?.length
        ? this.dataSources.missing(widgetDef.dataSources)
        : [];
      const component =
        widgetDef && missingDataSources.length === 0
          ? (widgetDef.component as Type<unknown>)
          : null;
      sections.push({
        entry,
        component,
        pendingDrop: pending.has(slot),
        keepOverride: !ok && keeps.has(slot) && !pending.has(slot),
        injector: this.slotInjectorFor(slot),
        missingDataSources,
      });
    }

    // P-2 (r3 plan §6.1): observe composition-render latency. Computed
    // memoization bounds the rate — this only fires when one of the
    // tracked signals (form, context, prompts, overrides) actually changes.
    this.telemetry.histogram(
      'form.composition.evaluate_ms',
      performance.now() - start,
      {
        form: def.name,
        sectionsTotal: totalEntries,
        sectionsVisible: sections.length,
      },
    );

    return sections;
  });

  // Detect predicate transitions to drive AC-F1-2 confirmation prompts.
  // Tracked imperatively because we need to compare new vs prior state.
  private prevPredicateOk: ReadonlyMap<string, boolean> = new Map();
  private prevFormName: string | undefined;

  constructor() {
    effect(() => {
      const def = this.form();
      const name = def?.name;

      // Form switched — reset transient state including cached injectors,
      // because slot keys mean different things across different forms.
      if (name !== this.prevFormName) {
        this.store.clear();
        // Seed composition slots from `initialValues` so section widgets
        // mount with the agent-/host-supplied values already present.
        // Done here (after clear, before sections render) so it can't be
        // clobbered by the reset and section widgets see it on construct.
        if (def?.composition) {
          for (const [slot, value] of Object.entries(this.initialValues())) {
            if (value !== undefined) this.store.write(slot, value);
          }
        }
        this.pendingPrompts.set(new Set());
        this.keepOverrides.set(new Set());
        this.slotInjectors.clear();
        this.prevPredicateOk = new Map();
        this.prevFormName = name;
      }

      if (!def?.composition) {
        this.prevPredicateOk = new Map();
        return;
      }

      const ctx = this.context();
      const next = new Map<string, boolean>();

      for (const entry of def.composition) {
        const slot = entry.widget;
        const ok = entry.predicate ? entry.predicate(ctx) : true;
        next.set(slot, ok);

        const was = this.prevPredicateOk.get(slot);
        if (was === true && ok === false) {
          // Newly hidden by predicate — interrupt unmount when dirty.
          if (this.store.isDirty(slot)) {
            this.pendingPrompts.update((s) => {
              if (s.has(slot)) return s;
              const dup = new Set(s);
              dup.add(slot);
              return dup;
            });
          }
        } else if (was === false && ok === true) {
          // Newly re-allowed — clear any prompt / keep override for this slot.
          this.pendingPrompts.update((s) => {
            if (!s.has(slot)) return s;
            const dup = new Set(s);
            dup.delete(slot);
            return dup;
          });
          this.keepOverrides.update((s) => {
            if (!s.has(slot)) return s;
            const dup = new Set(s);
            dup.delete(slot);
            return dup;
          });
        }
      }

      this.prevPredicateOk = next;
    });
  }

  ngOnInit(): void {
    this.values.set({ ...this.initialValues() });
  }

  protected readField(key: string): unknown {
    return this.values()[key];
  }

  protected writeField(key: string, value: unknown): void {
    this.values.update((cur) => ({ ...cur, [key]: value }));
  }

  /** Native input type for text-like widgets; anything else falls back to text. */
  protected inputType(widget: FormFieldUi['widget']): string {
    return widget === 'email' || widget === 'tel' || widget === 'url' || widget === 'password' ? widget : 'text';
  }

  protected errorFor(key: string): string | undefined {
    return this.errors()[key];
  }

  /** Drop the slot's stored value and dismiss the prompt. */
  protected dropSection(slot: string): void {
    this.store.drop(slot);
    this.pendingPrompts.update((s) => {
      if (!s.has(slot)) return s;
      const dup = new Set(s);
      dup.delete(slot);
      return dup;
    });
    // keepOverrides is not set, so the section will unmount on next pass.
  }

  /** Promote a pending prompt to a sticky "keep visible" override. */
  protected keepSection(slot: string): void {
    this.pendingPrompts.update((s) => {
      if (!s.has(slot)) return s;
      const dup = new Set(s);
      dup.delete(slot);
      return dup;
    });
    this.keepOverrides.update((s) => {
      if (s.has(slot)) return s;
      const dup = new Set(s);
      dup.add(slot);
      return dup;
    });
  }

  /**
   * Dispatch a non-submit action button. Submit buttons keep `type="submit"`
   * and go through the form's native submit → `onSubmit()`, so they never reach
   * here (the template guards `a.kind !== 'submit'`), avoiding double dispatch.
   */
  protected async runAction(a: FormActionDef): Promise<void> {
    switch (a.kind) {
      case 'reset':
        this.resetForm();
        return;
      case 'cancel':
        this.formAction.emit({ event: 'cancel' });
        return;
      case 'navigate':
        this.router?.navigateByUrl(a.to);
        return;
      case 'emit':
        this.formAction.emit({ event: a.event, detail: a.detail ? { ...a.detail } : undefined });
        return;
      case 'tool': {
        const tool = this.tools.get(a.tool);
        if (!tool) return;
        await tool.handler({ ...(a.args ?? {}), ...this.currentValues() }, this.buildToolCtx());
        return;
      }
      case 'action': {
        const def = this.actionsRegistry.byType(a.action);
        if (!def) return;
        const payload = { ...(a.payload ?? {}), values: this.currentValues() };
        const result = this.validators.validate<Record<string, unknown>>(def.payloadSchema, payload);
        if (!result.success) return;
        await Promise.resolve(def.effect(result.data!, this.buildActionCtx()));
        return;
      }
      // 'submit' never reaches here (guarded in the template).
    }
  }

  /** Current values regardless of form mode. */
  private currentValues(): Record<string, unknown> {
    return this.form()?.composition
      ? (this.store.snapshot() as Record<string, unknown>)
      : this.values();
  }

  /** Reset the form back to its initial values (both modes). */
  private resetForm(): void {
    this.errors.set({});
    const initial = this.initialValues();
    if (this.form()?.composition) {
      this.store.clear();
      for (const [slot, value] of Object.entries(initial)) {
        if (value !== undefined) this.store.write(slot, value);
      }
    } else {
      this.values.set({ ...initial });
    }
  }

  /**
   * Minimal `ToolContext` for a form-triggered tool. Long-running operation
   * methods are no-ops (form action buttons are simple governed calls; progress
   * surfaces belong to the chat/orchestrator path). Ids are synthesized.
   */
  private buildToolCtx(): ToolContext {
    const id = `form-${this.formName()}-${this.actionSeq++}`;
    return {
      threadId: id,
      runId: id,
      toolCallId: id,
      signal: new AbortController().signal,
      startOperation: () => id,
      reportProgress: () => undefined,
      completeOperation: () => undefined,
      failOperation: () => undefined,
    };
  }

  private buildActionCtx(): ActionContext {
    const id = `form-${this.formName()}-${this.actionSeq++}`;
    return {
      threadId: id,
      runId: id,
      actionId: id,
      signal: new AbortController().signal,
    };
  }

  protected async onSubmit(): Promise<void> {
    const def = this.form();
    if (!def) return;
    if (def.composition) {
      this.submitting.set(true);
      try {
        await def.submit(this.store.snapshot() as never);
      } finally {
        this.submitting.set(false);
      }
      return;
    }
    const result = this.validators.validate<Record<string, unknown>>(def.fieldsSchema, this.values());
    if (!result.success) {
      const map: Record<string, string> = {};
      for (const e of result.errors ?? []) map[e.path] = e.message;
      this.errors.set(map);
      return;
    }
    this.errors.set({});
    this.submitting.set(true);
    try {
      await def.submit(result.data!);
    } finally {
      this.submitting.set(false);
    }
  }
}

function prettyLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
