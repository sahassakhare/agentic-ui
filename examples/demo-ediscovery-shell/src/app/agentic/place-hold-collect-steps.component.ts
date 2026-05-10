import {
  ChangeDetectionStrategy, Component, computed, effect, inject, input, signal,
  type OnDestroy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { COMPOSITION_SLOT, CompositionStore } from '@maverick/agentic-ui';
import { MatterStore } from '../services/matter.store';
import { PersonaService, type Persona } from '../services/persona.service';

/**
 * Step widgets for the `placeLegalHoldAndCollect` complex workflow
 * (plan R5). Demonstrates four patterns the simpler `placeLegalHold`
 * workflow doesn't cover:
 *
 *  1. **Multi-actor / persona-gated steps** — each step declares the
 *     persona that's expected to perform it. When the active
 *     `PersonaService.active()` doesn't match, the step renders a
 *     "waiting on …" panel and the operator must switch personas to
 *     advance. This is the demo's stand-in for federated workflow
 *     handoff (lead-counsel drafts, associate approves,
 *     lead-counsel collects).
 *
 *  2. **Human-in-the-loop pause** — the approval step intentionally
 *     blocks advancement until the right persona acknowledges. The
 *     workflow renderer doesn't strictly "pause" (its Next button
 *     doesn't know about persona); operators just can't progress
 *     until they've taken the next person's seat.
 *
 *  3. **Long-running step with live progress** — the collection step
 *     simulates a 5-second async operation with a progress bar and
 *     status messages. Cleanly cancellable on widget teardown.
 *
 *  4. **Conditional re-route** — the workflow def's `next` function
 *     branches on `state['custodians'].length === 0` -> back to the
 *     custodian step rather than skipping ahead.
 *
 * Persistence (resume after refresh) is a follow-up — the plan
 * documents it but ships without it.
 */

interface MatterSetupValue {
  readonly matterId: string;
  readonly scope: string;
}

const EMPTY_MATTER_SETUP: MatterSetupValue = { matterId: '', scope: '' };

/** Reusable persona-gate panel — one component, every step uses it. */
@Component({
  selector: 'app-step-persona-gate',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="gate" role="status">
      <span class="icon" aria-hidden="true">⏸</span>
      <div>
        <strong>Waiting on {{ expected() }}</strong>
        <p>This step is gated to <code>{{ expected() }}</code>. You're currently <code>{{ active() }}</code>. Switch personas in the top header to advance.</p>
      </div>
    </div>
  `,
  styles: `
    :host { display: block; }
    .gate {
      display: flex; gap: 0.75rem; align-items: flex-start;
      padding: 0.75rem 1rem;
      background: #fef3c7; color: #78350f;
      border-radius: 0.4rem;
    }
    .icon { font-size: 1.25rem; }
    p { margin: 0.2rem 0 0; font-size: 0.85rem; }
    code { font-family: ui-monospace, monospace; background: rgba(255,255,255,0.6); padding: 0.0625rem 0.3125rem; border-radius: 0.25rem; }
  `,
})
export class StepPersonaGate {
  readonly active = input.required<string>();
  readonly expected = input.required<string>();
}

@Component({
  selector: 'app-step-matter-setup',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, StepPersonaGate],
  template: `
    @if (!gateOpen()) {
      <app-step-persona-gate [active]="active()" expected="lead-counsel" />
    } @else {
      <p class="hint">Confirm matter scope before drafting the hold.</p>
      <label>Matter ID
        <input type="text" [ngModel]="value().matterId"
               (ngModelChange)="patch({ matterId: $event })" name="matterId"
               placeholder="MAT-2026-001" />
      </label>
      <label>Scope
        <textarea rows="3" [ngModel]="value().scope"
                  (ngModelChange)="patch({ scope: $event })" name="scope"
                  placeholder='All emails about Project Phoenix from 2024-09 onward'></textarea>
      </label>
    }
  `,
  styles: `
    :host { display: block; }
    .hint { margin: 0 0 0.4rem; color: #6b7280; font-size: 0.8rem; }
    label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.85rem; color: #374151; margin-bottom: 0.5rem; }
    input, textarea { padding: 0.4rem 0.5rem; border: 1px solid #d1d5db; border-radius: 0.3rem; font: inherit; }
  `,
})
export class MatterSetupStepComponent {
  private readonly slot = inject(COMPOSITION_SLOT, { optional: true });
  private readonly store = inject(CompositionStore, { optional: true });
  private readonly persona = inject(PersonaService);

  protected readonly active = computed(() => this.persona.active());
  protected readonly gateOpen = computed(() => this.active() === 'lead-counsel');

  protected readonly value = computed<MatterSetupValue>(() => {
    if (!this.store || !this.slot) return EMPTY_MATTER_SETUP;
    return (this.store.values()[this.slot] as MatterSetupValue | undefined) ?? EMPTY_MATTER_SETUP;
  });

  protected patch(part: Partial<MatterSetupValue>): void {
    if (!this.store || !this.slot) return;
    this.store.write(this.slot, { ...this.value(), ...part });
  }
}

@Component({
  selector: 'app-step-custodian-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StepPersonaGate],
  template: `
    @if (!gateOpen()) {
      <app-step-persona-gate [active]="active()" expected="lead-counsel" />
    } @else {
      <p class="hint">Pick the custodians this hold covers. Zero selected sends you back to step 1.</p>
      <ul class="picker">
        @for (c of custodians(); track c.id) {
          <li>
            <label>
              <input type="checkbox" [checked]="isSelected(c.id)" (change)="toggle(c.id)" />
              <span><strong>{{ c.name }}</strong> · {{ c.email }}</span>
              <span class="dim">{{ c.department }}</span>
            </label>
          </li>
        } @empty {
          <li class="empty">No custodians on this matter yet — add some via the chat agent first.</li>
        }
      </ul>
      <p class="dim">{{ selected().length }} selected</p>
    }
  `,
  styles: `
    :host { display: block; }
    .hint { margin: 0 0 0.4rem; color: #6b7280; font-size: 0.8rem; }
    .picker { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.25rem; }
    label { display: grid; grid-template-columns: auto 1fr auto; gap: 0.5rem; align-items: center; padding: 0.4rem 0.6rem; border: 1px solid #e5e7eb; border-radius: 0.3rem; font-size: 0.85rem; cursor: pointer; }
    label:hover { background: #f9fafb; }
    .dim { color: #6b7280; font-size: 0.75rem; }
    .empty { color: #6b7280; font-style: italic; }
  `,
})
export class CustodianSelectStepComponent {
  private readonly slot = inject(COMPOSITION_SLOT, { optional: true });
  private readonly store = inject(CompositionStore, { optional: true });
  private readonly persona = inject(PersonaService);
  private readonly matter = inject(MatterStore);

  protected readonly active = computed(() => this.persona.active());
  protected readonly gateOpen = computed(() => this.active() === 'lead-counsel');
  protected readonly custodians = this.matter.custodians;

  protected readonly selected = computed<readonly string[]>(() => {
    if (!this.store || !this.slot) return [];
    const v = this.store.values()[this.slot];
    return Array.isArray(v) ? (v as readonly string[]) : [];
  });

  protected isSelected(id: string): boolean {
    return this.selected().includes(id);
  }

  protected toggle(id: string): void {
    if (!this.store || !this.slot) return;
    const cur = this.selected();
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    this.store.write(this.slot, next);
  }
}

@Component({
  selector: 'app-step-approval',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StepPersonaGate],
  template: `
    @if (!gateOpen()) {
      <app-step-persona-gate [active]="active()" expected="associate" />
    } @else {
      <div class="card" role="region" aria-label="Hold approval">
        <h4>Approve the hold notice</h4>
        <p>Switching to associate allows you to authorise the hold. Lead-counsel drafts; you sign off; lead-counsel sends and collects.</p>
        <div class="row">
          <button type="button" class="approve" (click)="setDecision(true)" [class.active]="decision() === true">✓ Approve</button>
          <button type="button" class="reject"  (click)="setDecision(false)" [class.active]="decision() === false">✗ Reject</button>
        </div>
        @if (decision() === true) {
          <p class="ok">Approved at {{ decidedAt() }}. Click Next to hand off.</p>
        } @else if (decision() === false) {
          <p class="bad">Rejected. Click Back to revise the draft.</p>
        }
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .card { padding: 0.75rem 1rem; border: 1px solid #e5e7eb; border-radius: 0.4rem; }
    h4 { margin: 0 0 0.4rem; font-size: 0.95rem; }
    p { margin: 0.4rem 0; font-size: 0.85rem; color: #374151; }
    .row { display: flex; gap: 0.5rem; margin-top: 0.6rem; }
    button { flex: 1; padding: 0.5rem 0.75rem; border-radius: 0.3rem; border: 1px solid #d1d5db; background: #fff; cursor: pointer; font: inherit; }
    button.approve.active { background: #16a34a; color: white; border-color: #16a34a; }
    button.reject.active { background: #dc2626; color: white; border-color: #dc2626; }
    .ok { color: #166534; font-weight: 500; }
    .bad { color: #991b1b; font-weight: 500; }
  `,
})
export class ApprovalStepComponent {
  private readonly slot = inject(COMPOSITION_SLOT, { optional: true });
  private readonly store = inject(CompositionStore, { optional: true });
  private readonly persona = inject(PersonaService);

  protected readonly active = computed(() => this.persona.active());
  protected readonly gateOpen = computed(() => this.active() === 'associate');

  protected readonly decision = computed<boolean | null>(() => {
    if (!this.store || !this.slot) return null;
    const v = this.store.values()[this.slot] as { approved?: boolean; at?: string } | undefined;
    return v?.approved ?? null;
  });

  protected readonly decidedAt = computed<string>(() => {
    if (!this.store || !this.slot) return '';
    const v = this.store.values()[this.slot] as { approved?: boolean; at?: string } | undefined;
    return v?.at ?? '';
  });

  protected setDecision(approved: boolean): void {
    if (!this.store || !this.slot) return;
    this.store.write(this.slot, { approved, at: new Date().toLocaleTimeString() });
  }
}

const COLLECT_DURATION_MS = 5000;

@Component({
  selector: 'app-step-collect',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [StepPersonaGate],
  template: `
    @if (!gateOpen()) {
      <app-step-persona-gate [active]="active()" expected="lead-counsel" />
    } @else {
      <p class="hint">Long-running step — simulates the actual collection job. ~5s.</p>
      <div class="progress" [class.done]="phase() === 'done'">
        <div class="bar" [style.width.%]="progressPct()"></div>
      </div>
      <p class="status">
        @switch (phase()) {
          @case ('idle')        { Ready to send notices and start collection. }
          @case ('sending')     { Sending hold notices to {{ targetCount }} custodian(s)… }
          @case ('collecting')  { Collecting documents — {{ progressPct() }}% }
          @case ('done')        { Collection complete · {{ targetCount * 12 }} documents pulled }
        }
      </p>
      @if (phase() === 'idle') {
        <button type="button" class="primary" (click)="start()">Send + collect</button>
      }
    }
  `,
  styles: `
    :host { display: block; }
    .hint { margin: 0 0 0.4rem; color: #6b7280; font-size: 0.8rem; }
    .progress { width: 100%; height: 6px; background: #e5e7eb; border-radius: 999px; overflow: hidden; }
    .bar { height: 100%; background: #2563eb; transition: width 200ms; }
    .progress.done .bar { background: #16a34a; }
    .status { margin: 0.5rem 0; font-size: 0.85rem; color: #374151; }
    button { padding: 0.4rem 0.9rem; border: 1px solid #2563eb; background: #2563eb; color: white; border-radius: 0.3rem; cursor: pointer; font: inherit; }
  `,
})
export class CollectStepComponent implements OnDestroy {
  private readonly slot = inject(COMPOSITION_SLOT, { optional: true });
  private readonly store = inject(CompositionStore, { optional: true });
  private readonly persona = inject(PersonaService);

  protected readonly active = computed(() => this.persona.active());
  protected readonly gateOpen = computed(() => this.active() === 'lead-counsel');

  protected readonly phase = signal<'idle' | 'sending' | 'collecting' | 'done'>('idle');
  protected readonly progressPct = signal<number>(0);
  protected readonly targetCount = 3;

  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor() {
    // Restore phase if the user comes back to this step after Next/Back.
    effect(() => {
      if (!this.store || !this.slot) return;
      const v = this.store.values()[this.slot] as { phase?: string; pct?: number } | undefined;
      if (v?.phase === 'done') {
        this.phase.set('done');
        this.progressPct.set(100);
      }
    });
  }

  start(): void {
    if (this.phase() !== 'idle') return;
    this.phase.set('sending');
    this.progressPct.set(5);
    const t1 = setTimeout(() => {
      this.phase.set('collecting');
      let p = 10;
      const tick = setInterval(() => {
        p = Math.min(100, p + 8);
        this.progressPct.set(p);
        if (p >= 100) {
          clearInterval(tick);
          this.phase.set('done');
          if (this.store && this.slot) this.store.write(this.slot, { phase: 'done', pct: 100 });
        }
      }, 350);
      this.timers.push(tick as unknown as ReturnType<typeof setTimeout>);
    }, 600);
    this.timers.push(t1);
  }

  ngOnDestroy(): void {
    for (const t of this.timers) clearTimeout(t);
  }
}

@Component({
  selector: 'app-step-collect-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="preview">
      <h4>Ready to commit</h4>
      <p>Click Submit to write the hold + collection summary into the matter audit chain. The same handler the chat agent's <code>placeLegalHold</code> tool uses fires here — single source of truth.</p>
    </div>
  `,
  styles: `
    :host { display: block; }
    .preview { padding: 0.75rem 1rem; background: #ecfdf5; color: #065f46; border-radius: 0.4rem; }
    h4 { margin: 0 0 0.4rem; font-size: 0.95rem; }
    p { margin: 0; font-size: 0.85rem; }
    code { font-family: ui-monospace, monospace; background: rgba(255,255,255,0.6); padding: 0.0625rem 0.3125rem; border-radius: 0.25rem; }
  `,
})
export class CollectPreviewStepComponent {}

/** Re-export the persona type for the workflow's onComplete handler. */
export type { Persona };
