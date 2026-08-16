import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CapabilityCatalogService } from '../services/capability-catalog.service';
import {
  evaluateDecision, opsForType,
  type DecisionField, type DecisionRule, type DecisionOp, type DecisionType, type HitPolicy, type DecisionTable,
} from '../decision/decision-eval';
import { LifecycleBarComponent } from '../lifecycle-bar.component';
import type { Lifecycle } from '../lifecycle';
import type { HasUnsavedChanges } from '../guards/unsaved-changes.guard';

const HIT_POLICIES: HitPolicy[] = ['first', 'unique', 'collect'];
const TYPES: DecisionType[] = ['string', 'number', 'boolean', 'date'];

/**
 * Decision Table Designer — authors a DMN-style decision table (`kind:'decision'`):
 * inputs, outputs, and rules (rows of input conditions → output values), with a
 * hit policy and a live "test" panel that runs the evaluator. Workflows/forms
 * reference the saved decision by name for governed branching/validation.
 */
@Component({
  selector: 'aes-decision-designer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, LifecycleBarComponent],
  template: `
    <div class="wrap">
      <header class="head">
        <a routerLink="/decisions" class="back">← Decisions</a>
        <h1>{{ name() || 'Decision' }} · Table</h1>
        <label class="hp">Hit policy
          <select [(ngModel)]="hitPolicy">@for (h of hitPolicies; track h) { <option [value]="h">{{ h }}</option> }</select>
        </label>
        <span class="sp"></span>
        <aes-lifecycle-bar [lifecycle]="lifecycle()" [busy]="saving()" (transition)="setLifecycle($event)" />
        @if (saved()) { <span class="ok">✓ saved</span> }
        <button class="btn primary" (click)="save()" [disabled]="saving()">Save decision</button>
      </header>

      @if (loading()) { <p class="muted">Loading…</p> }
      @else {
        <section class="card">
          <div class="cols">
            <div class="colset">
              <span class="lbl">Inputs</span>
              @for (f of inputs(); track $index) {
                <span class="chip in">
                  <input [ngModel]="f.name" (ngModelChange)="rename('inputs', $index, $event)" aria-label="Input name" />
                  <select class="ty" [ngModel]="f.type ?? 'string'" (ngModelChange)="setColType('inputs', $index, $event)" title="Data type" aria-label="Input type">@for (t of types; track t) { <option [value]="t">{{ t }}</option> }</select>
                  <button (click)="delCol('inputs', $index)" aria-label="Remove input">✕</button>
                </span>
              }
              <button class="add" (click)="addCol('inputs')">＋ input</button>
            </div>
            <div class="colset">
              <span class="lbl">Outputs</span>
              @for (f of outputs(); track $index) {
                <span class="chip out">
                  <input [ngModel]="f.name" (ngModelChange)="rename('outputs', $index, $event)" aria-label="Output name" />
                  <select class="ty" [ngModel]="f.type ?? 'string'" (ngModelChange)="setColType('outputs', $index, $event)" title="Data type" aria-label="Output type">@for (t of types; track t) { <option [value]="t">{{ t }}</option> }</select>
                  <button (click)="delCol('outputs', $index)" aria-label="Remove output">✕</button>
                </span>
              }
              <button class="add" (click)="addCol('outputs')">＋ output</button>
            </div>
          </div>

          <div class="tablewrap">
            <table class="dt">
              <thead>
                <tr>
                  <th class="rn">#</th>
                  @for (f of inputs(); track $index) { <th class="in">{{ f.name || 'input' }} <span class="tybadge">{{ f.type ?? 'string' }}</span></th> }
                  @for (f of outputs(); track $index) { <th class="out">{{ f.name || 'output' }}</th> }
                  <th class="note">Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (r of rules(); track $index; let ri = $index) {
                  <tr>
                    <td class="rn">{{ ri + 1 }}</td>
                    @for (f of inputs(); track f.name; let ci = $index) {
                      <td class="in">
                        <select [ngModel]="cellOp(ri, f.name)" (ngModelChange)="setCellOp(ri, f.name, $event)">@for (o of opsFor(f); track o) { <option [value]="o">{{ o }}</option> }</select>
                        @if (cellOp(ri, f.name) !== 'any') { <input [type]="testType(f)" [ngModel]="cellVal(ri, f.name)" (ngModelChange)="setCellVal(ri, f.name, $event)" placeholder="value" /> }
                      </td>
                    }
                    @for (f of outputs(); track f.name) {
                      <td class="out"><input [ngModel]="thenVal(ri, f.name)" (ngModelChange)="setThen(ri, f.name, $event)" placeholder="value" /></td>
                    }
                    <td class="note"><input [ngModel]="annVal(ri)" (ngModelChange)="setAnnotation(ri, $event)" placeholder="note" aria-label="Rule note" /></td>
                    <td><button class="x" (click)="delRule(ri)">✕</button></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <button class="btn ghost sm" (click)="addRule()">＋ Add rule</button>
        </section>

        <section class="card test">
          <div class="eyebrow">Test <span class="muted sm">— run the evaluator on sample inputs</span></div>
          <div class="testrow">
            @for (f of inputs(); track f.name) {
              <label class="tin">{{ f.name }} <span class="tybadge">{{ f.type ?? 'string' }}</span><input [type]="testType(f)" [ngModel]="testInput()[f.name] || ''" (ngModelChange)="setTest(f.name, $event)" /></label>
            }
            <button class="btn" (click)="runTest()">Evaluate →</button>
          </div>
          @if (result(); as res) {
            @if (res.outputs) {
              <div class="res ok">matched rule(s) {{ resRuleLabels() }} → {{ json(res.outputs) }}</div>
              @if (res.conflict) { <div class="res warn">⚠ Hit policy is “unique” but multiple rules matched — your rules overlap. Make them disjoint or switch to “first”/“collect”.</div> }
            }
            @else { <div class="res no">no rule matched</div> }
          }
        </section>
      }
    </div>
  `,
  styles: [`
    .wrap { padding:20px 24px; max-width:1150px; margin:0 auto; }
    .head { display:flex; align-items:center; gap:14px; margin-bottom:18px; }
    .head h1 { font-size:18px; margin:0; } .back { font-size:13px; text-decoration:none; opacity:.7; } .sp { flex:1; }
    .hp { font-size:12px; display:flex; align-items:center; gap:6px; } .hp select { font:inherit; padding:5px 8px; border-radius:7px; border:1px solid rgba(120,120,140,.3); background:transparent; color:inherit; }
    .ok { color:#0a7d32; font-size:13px; }
    .btn { font:inherit; padding:8px 14px; border-radius:9px; border:1px solid rgba(120,120,140,.3); background:transparent; color:inherit; cursor:pointer; }
    .btn.primary { background:#6750a4; color:#fff; border-color:#6750a4; font-weight:600; } .btn.ghost.sm { font-size:12px; padding:6px 10px; margin-top:10px; } .btn[disabled] { opacity:.5; }
    .card { border:1px solid rgba(120,120,140,.18); border-radius:14px; padding:16px; margin-bottom:16px; }
    .eyebrow { font-size:11px; text-transform:uppercase; letter-spacing:.06em; opacity:.55; margin-bottom:10px; } .muted { opacity:.6; } .sm { font-size:12px; }
    .cols { display:flex; gap:24px; flex-wrap:wrap; margin-bottom:14px; } .colset { display:flex; align-items:center; gap:8px; flex-wrap:wrap; } .lbl { font-size:12px; font-weight:700; text-transform:uppercase; opacity:.6; }
    .chip { display:inline-flex; align-items:center; gap:4px; padding:3px 4px 3px 8px; border-radius:8px; font-size:12px; } .chip.in { background:rgba(103,80,164,.1); } .chip.out { background:rgba(10,125,50,.1); }
    .chip input { border:none; background:transparent; color:inherit; font:inherit; font-size:12px; width:80px; } .chip button, .add { border:none; background:transparent; color:inherit; opacity:.6; cursor:pointer; font:inherit; font-size:12px; }
    .add { padding:4px 8px; border:1px dashed rgba(120,120,140,.4); border-radius:8px; }
    .tablewrap { overflow-x:auto; } .dt { border-collapse:collapse; width:100%; font-size:12.5px; } .dt th, .dt td { border:1px solid rgba(120,120,140,.18); padding:6px 8px; text-align:left; vertical-align:top; }
    .dt th.in, .dt td.in { background:rgba(103,80,164,.05); } .dt th.out, .dt td.out { background:rgba(10,125,50,.05); } .dt .rn { opacity:.5; width:28px; text-align:center; }
    .dt select, .dt input { font:inherit; font-size:12px; padding:4px 6px; border:1px solid rgba(120,120,140,.25); border-radius:6px; background:transparent; color:inherit; width:100%; margin-top:3px; }
    .dt select { margin-top:0; } .dt .x { border:none; background:transparent; color:inherit; opacity:.5; cursor:pointer; }
    .test .testrow { display:flex; gap:10px; align-items:end; flex-wrap:wrap; } .tin { display:flex; flex-direction:column; font-size:12px; gap:3px; } .tin input { font:inherit; padding:7px 9px; border:1px solid rgba(120,120,140,.3); border-radius:7px; background:transparent; color:inherit; }
    .res { margin-top:12px; padding:10px 12px; border-radius:9px; font-size:13px; font-family:ui-monospace,Menlo,monospace; } .res.ok { background:rgba(10,125,50,.1); color:#0a7d32; } .res.no { background:rgba(192,57,43,.1); color:#c0392b; } .res.warn { background:rgba(203,143,0,.12); color:#a86a00; margin-top:8px; }
    .chip .ty { border:none; background:transparent; color:inherit; font:inherit; font-size:11px; opacity:.7; cursor:pointer; }
    .tybadge { font-size:9px; text-transform:uppercase; letter-spacing:.04em; opacity:.5; font-weight:600; }
    .dt th.note, .dt td.note { background:rgba(120,120,140,.03); } .dt td.note input { font:inherit; font-size:12px; padding:4px 6px; border:1px solid rgba(120,120,140,.25); border-radius:6px; background:transparent; color:inherit; width:100%; }
  `],
})
export class DecisionDesignerComponent implements HasUnsavedChanges {
  private readonly caps = inject(CapabilityCatalogService);
  readonly id = input.required<string>();

  protected readonly hitPolicies = HIT_POLICIES;
  protected readonly types = TYPES;
  protected readonly name = signal('');
  protected readonly inputs = signal<DecisionField[]>([]);
  protected readonly outputs = signal<DecisionField[]>([]);
  protected readonly rules = signal<DecisionRule[]>([]);
  protected readonly hitPolicy = signal<HitPolicy>('first');
  protected readonly testInput = signal<Record<string, string>>({});
  protected readonly result = signal<ReturnType<typeof evaluateDecision> | null>(null);
  private description = '';
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly lifecycle = signal<Lifecycle>('draft');
  private pristine = '';

  constructor() { queueMicrotask(() => this.load()); }

  private load(): void {
    this.caps.get(this.id()).subscribe((c) => {
      const b = c.body as { description?: string; inputs?: DecisionField[]; outputs?: DecisionField[]; rules?: DecisionRule[]; hitPolicy?: HitPolicy };
      this.name.set(c.name);
      this.description = b.description ?? '';
      this.inputs.set([...(b.inputs ?? [])]);
      this.outputs.set([...(b.outputs ?? [])]);
      this.rules.set((b.rules ?? []).map((r) => ({ ...r, when: { ...r.when }, then: { ...r.then } })));
      this.hitPolicy.set(b.hitPolicy ?? 'first');
      this.lifecycle.set((c.lifecycle as Lifecycle) ?? 'draft');
      this.loading.set(false);
      this.pristine = this.snapshot();
    });
  }

  // ── governance + unsaved-changes guard ──────────────────────────────────────
  private snapshot(): string {
    return JSON.stringify({ inputs: this.inputs(), outputs: this.outputs(), rules: this.rules(), hitPolicy: this.hitPolicy() });
  }
  hasUnsavedChanges(): boolean { return !this.loading() && this.snapshot() !== this.pristine; }
  setLifecycle(next: Lifecycle): void {
    this.caps.update(this.id(), { lifecycle: next }).subscribe({ next: () => this.lifecycle.set(next), error: () => {} });
  }

  protected json(o: unknown): string { return JSON.stringify(o); }
  protected cellOp(ri: number, name: string): DecisionOp { return this.rules()[ri].when[name]?.op ?? 'any'; }
  protected cellVal(ri: number, name: string): string { return this.rules()[ri].when[name]?.value ?? ''; }
  protected thenVal(ri: number, name: string): string { return this.rules()[ri].then[name] ?? ''; }
  protected annVal(ri: number): string { return this.rules()[ri].annotation ?? ''; }
  protected resRuleLabels(): string { return (this.result()?.matchedRules ?? []).map((i) => i + 1).join(', '); }
  /** Operators valid for a column, given its data type. */
  protected opsFor(f: DecisionField) { return opsForType(f.type); }
  /** HTML input type for the test panel + cell value entry. */
  protected testType(f: DecisionField): string { return f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'; }

  private mutRules(fn: (r: DecisionRule[]) => void): void { this.rules.update((cur) => { const c = cur.map((r) => ({ ...r, when: { ...r.when }, then: { ...r.then } })); fn(c); return c; }); this.saved.set(false); }

  protected addCol(which: 'inputs' | 'outputs'): void {
    const sig = which === 'inputs' ? this.inputs : this.outputs;
    sig.update((c) => [...c, { name: `${which === 'inputs' ? 'input' : 'output'}${c.length + 1}` }]);
    this.saved.set(false);
  }
  protected delCol(which: 'inputs' | 'outputs', i: number): void { (which === 'inputs' ? this.inputs : this.outputs).update((c) => c.filter((_, idx) => idx !== i)); this.saved.set(false); }
  protected rename(which: 'inputs' | 'outputs', i: number, v: string): void { (which === 'inputs' ? this.inputs : this.outputs).update((c) => c.map((f, idx) => (idx === i ? { ...f, name: v } : f))); this.saved.set(false); }
  protected setColType(which: 'inputs' | 'outputs', i: number, type: DecisionType): void { (which === 'inputs' ? this.inputs : this.outputs).update((c) => c.map((f, idx) => (idx === i ? { ...f, type } : f))); this.saved.set(false); }

  protected addRule(): void { this.mutRules((r) => r.push({ when: {}, then: {} })); }
  protected delRule(i: number): void { this.mutRules((r) => r.splice(i, 1)); }
  protected setCellOp(ri: number, name: string, op: DecisionOp): void { this.mutRules((r) => { r[ri].when[name] = { op, value: r[ri].when[name]?.value }; }); }
  protected setCellVal(ri: number, name: string, value: string): void { this.mutRules((r) => { r[ri].when[name] = { op: r[ri].when[name]?.op ?? '==', value }; }); }
  protected setThen(ri: number, name: string, value: string): void { this.mutRules((r) => { r[ri].then[name] = value; }); }
  protected setAnnotation(ri: number, value: string): void { this.mutRules((r) => { r[ri].annotation = value; }); }

  protected setTest(name: string, v: string): void { this.testInput.update((c) => ({ ...c, [name]: v })); }
  protected runTest(): void {
    const table: DecisionTable = { inputs: this.inputs(), outputs: this.outputs(), rules: this.rules(), hitPolicy: this.hitPolicy() };
    this.result.set(evaluateDecision(table, this.testInput()));
  }

  protected save(): void {
    this.saving.set(true);
    const body = { description: this.description, hitPolicy: this.hitPolicy(), inputs: this.inputs(), outputs: this.outputs(), rules: this.rules() };
    this.caps.update(this.id(), { body }).subscribe({
      next: () => { this.saving.set(false); this.saved.set(true); this.pristine = this.snapshot(); },
      error: () => { this.saving.set(false); },
    });
  }
}
