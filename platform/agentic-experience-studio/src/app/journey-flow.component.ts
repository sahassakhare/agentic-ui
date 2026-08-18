import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** A step's transition — string advance, terminal (null), conditional (state)
 *  branches, or a governed-decision branch (decision output → step). */
type StepNext =
  | string
  | null
  | { readonly branches: ReadonlyArray<{ readonly when: { field: string; op: string; value?: unknown }; readonly goto: string }>; readonly default: string | null }
  | { readonly decision: string; readonly output?: string; readonly cases: Readonly<Record<string, string>>; readonly default: string | null };

export interface JourneyFlowStep {
  readonly id: string;
  readonly widget: string;
  readonly section?: string;
  readonly next: StepNext;
}

interface Transition { readonly cond: string | null; readonly targetLabel: string; readonly terminal: boolean; }
interface FlowNode {
  readonly n: number; readonly id: string; readonly title: string; readonly widget: string;
  readonly decision: boolean; readonly terminal: boolean; readonly transitions: readonly Transition[];
}

const OP_WORD: Record<string, string> = { '==': 'is', '!=': 'is not', 'in': 'in', 'truthy': 'is set', 'falsy': 'is empty' };

/**
 * User-journey map (AEP Seam E). Renders a workflow's steps as a top-to-bottom
 * flow with a start/end, one node per step (widget + section), and — crucially —
 * **branch paths with their conditions labeled**, so a branching journey reads
 * as a journey, not a flat list. Pure/standalone; no layout engine.
 */
@Component({
  selector: 'aes-journey-flow',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="jflow">
      <div class="cap start"><span class="cdot"></span> Start</div>
      @for (node of nodes(); track node.id) {
        <div class="jnode" [class.decision]="node.decision" [class.terminal]="node.terminal">
          <span class="dot">{{ node.decision ? '◇' : node.n }}</span>
          <div class="jcard">
            <div class="jtitle">
              {{ node.title }}
              @if (node.decision) { <span class="chip decision">decision</span> }
              @else if (node.terminal) { <span class="chip end">final step</span> }
            </div>
            <div class="jsub">renders <code>{{ node.widget }}</code></div>
            @if (node.transitions.length) {
              <div class="jtrans">
                @for (t of node.transitions; track $index) {
                  <span class="tpill" [class.cond]="t.cond && t.cond !== 'otherwise'" [class.else]="t.cond === 'otherwise'">
                    @if (t.cond) { <b>{{ t.cond }}</b> }
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    @if (t.terminal) { <em>End</em> } @else { {{ t.targetLabel }} }
                  </span>
                }
              </div>
            }
          </div>
        </div>
      }
      <div class="cap end"><span class="cdot"></span> End</div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .jflow { position: relative; padding-left: 34px; display: flex; flex-direction: column; gap: var(--s3); }
    .jflow::before { content: ""; position: absolute; left: 15px; top: 10px; bottom: 10px; width: 2px; background: var(--border-strong); }
    .cap { display: inline-flex; align-items: center; gap: var(--s2); font-family: var(--font-mono); font-size: var(--fs-xs);
      text-transform: uppercase; letter-spacing: .08em; color: var(--text-muted); position: relative; }
    .cap .cdot { position: absolute; left: -27px; width: 12px; height: 12px; border-radius: 50%; background: var(--surface); border: 2px solid var(--border-strong); }
    .cap.start .cdot { border-color: var(--brand); background: var(--brand); }
    .cap.end .cdot { border-color: var(--ok); background: var(--ok); }
    .jnode { position: relative; display: flex; align-items: flex-start; gap: var(--s3); }
    .dot { position: absolute; left: -34px; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center;
      background: var(--brand-soft); color: var(--brand); font-weight: 650; font-size: var(--fs-sm); z-index: 1; border: 2px solid var(--bg); }
    .decision .dot { background: var(--warn-soft); color: var(--warn); font-size: 1rem; }
    .terminal .dot { background: var(--ok-soft); color: var(--ok); }
    .jcard { flex: 1; border: 1px solid var(--border); border-radius: var(--r-md); padding: var(--s3) var(--s4); background: var(--surface); }
    .decision .jcard { border-color: var(--warn-border); }
    .jtitle { font-weight: 600; display: flex; align-items: center; gap: var(--s2); }
    .jsub { font-size: var(--fs-sm); color: var(--text-muted); margin-top: 2px; }
    .jsub code { color: var(--text); background: var(--surface-2); padding: 1px 6px; border-radius: 5px; font-size: .92em; }
    .chip { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: .05em; padding: 2px 7px; border-radius: var(--r-full); }
    .chip.decision { background: var(--warn-soft); color: var(--warn); }
    .chip.end { background: var(--ok-soft); color: var(--ok); }
    .jtrans { display: flex; flex-wrap: wrap; gap: var(--s2); margin-top: var(--s3); }
    .tpill { display: inline-flex; align-items: center; gap: 5px; font-size: var(--fs-sm); padding: 4px 10px; border-radius: var(--r-full);
      background: var(--surface-2); border: 1px solid var(--border); color: var(--text); }
    .tpill b { color: var(--warn); font-weight: 600; }
    .tpill em { color: var(--ok); font-style: normal; font-weight: 600; }
    .tpill.cond { border-color: var(--warn-border); background: var(--warn-soft); }
    .tpill.else { border-style: dashed; }
  `],
})
export class JourneyFlowComponent {
  readonly steps = input.required<readonly JourneyFlowStep[]>();

  readonly nodes = computed<FlowNode[]>(() => {
    const steps = this.steps();
    const labelOf = (id: string | null): string =>
      id ? (steps.find((x) => x.id === id)?.section ?? id) : 'End';
    return steps.map((s, i) => {
      let decision = false, terminal = false;
      const transitions: Transition[] = [];
      if (s.next === null) {
        terminal = true;
      } else if (typeof s.next === 'string') {
        transitions.push({ cond: null, targetLabel: labelOf(s.next), terminal: false });
      } else if ('decision' in s.next) {
        decision = true;
        const label = s.next.output ? `${s.next.decision}.${s.next.output}` : s.next.decision;
        for (const [value, goto] of Object.entries(s.next.cases)) {
          transitions.push({ cond: `${label} = ${value}`, targetLabel: labelOf(goto), terminal: false });
        }
        transitions.push({ cond: 'otherwise', targetLabel: labelOf(s.next.default), terminal: s.next.default === null });
      } else {
        decision = true;
        for (const b of s.next.branches) {
          transitions.push({ cond: condLabel(b.when), targetLabel: labelOf(b.goto), terminal: false });
        }
        transitions.push({ cond: 'otherwise', targetLabel: labelOf(s.next.default), terminal: s.next.default === null });
      }
      return { n: i + 1, id: s.id, title: s.section ?? s.id, widget: s.widget, decision, terminal, transitions };
    });
  });
}

function condLabel(when: { field: string; op: string; value?: unknown }): string {
  const word = OP_WORD[when.op] ?? when.op;
  if (when.op === 'truthy' || when.op === 'falsy') return `${when.field} ${word}`;
  const v = Array.isArray(when.value) ? (when.value as unknown[]).join(' / ') : String(when.value);
  return `${when.field} ${word} ${v}`;
}
