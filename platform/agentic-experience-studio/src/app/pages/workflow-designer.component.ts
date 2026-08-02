import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CapabilityCatalogService, type Capability } from '../services/capability-catalog.service';
import { ToastService } from '../services/toast.service';
import { JourneyFlowComponent, type JourneyFlowStep } from '../journey-flow.component';

/**
 * Drag-and-drop Workflow / Experience designer — the HIERARCHY case. The
 * Component + Form registries are the palette; dragging one appends a step that
 * renders it (lateral sequence). A step can become a ◇ decision with branches
 * (when field op value → goto) — the hierarchy. The canvas IS the workflow's
 * `steps[]` JSON: `next` auto-chains by order for linear steps, or encodes a
 * ConditionalNext for decisions. Live JourneyFlow preview; saves to the workflow.
 */
interface Branch { field: string; op: '==' | '!=' | 'in' | 'truthy' | 'falsy'; value: string; goto: string; }
interface Step { id: string; section: string; widget: string; decision: boolean; branches: Branch[]; defaultNext: string; }
const OPS = ['==', '!=', 'in', 'truthy', 'falsy'] as const;

@Component({
  selector: 'aes-workflow-designer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, JourneyFlowComponent],
  template: `
    <div class="page wide">
      <a routerLink="/workflows" class="back">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="m15 6-6 6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Workflows
      </a>
      <div class="page-header" style="margin-top:var(--s4)">
        <div class="titles">
          <span class="eyebrow">Workflow designer · drag components as steps</span>
          <h1>{{ wf()?.name ?? 'Workflow' }}</h1>
          <p class="subtitle">The canvas is the workflow's <code>steps[]</code>. Steps chain in order; a ◇ decision branches (hierarchy).</p>
        </div>
        <button class="btn btn-primary" type="button" (click)="save()" [disabled]="saving()">
          @if (saving()) { <span class="spinner" aria-hidden="true"></span> Saving… } @else { Save workflow }
        </button>
      </div>

      <div class="designer">
        <aside class="palette card card-pad">
          <div class="eyebrow" style="margin-bottom:var(--s2)">Components &amp; forms</div>
          <input class="input" [(ngModel)]="q" placeholder="Search…" autocomplete="off" />
          <div class="pal-list">
            @for (c of palette(); track c.name) {
              <div class="pal-item" draggable="true" (dragstart)="startPaletteDrag(c.name)" (dragend)="drag.set(null)">
                <span class="grip">⋮⋮</span> {{ c.name }} <span class="kind">{{ c.kind }}</span>
              </div>
            }
          </div>
        </aside>

        <div class="canvas card card-pad" (dragover)="allow($event)" (drop)="dropOnCanvas($event)">
          <div class="eyebrow" style="margin-bottom:var(--s3)">Canvas · {{ steps().length }} step{{ steps().length === 1 ? '' : 's' }}</div>
          @if (!steps().length) { <div class="drop-empty">Drag components here to add steps.</div> }
          @for (s of steps(); track s.id; let i = $index) {
            <div class="step" [class.decision]="s.decision" draggable="true"
                 (dragstart)="startStepDrag(i, $event)" (dragend)="drag.set(null)"
                 (dragover)="allow($event)" (drop)="dropOnStep(i, $event)">
              <div class="srow">
                <span class="grip">⋮⋮</span>
                <span class="num">{{ s.decision ? '◇' : i + 1 }}</span>
                <input class="input flex" [ngModel]="s.section" (ngModelChange)="patch(i, { section: $event })" placeholder="Step title" />
                <span class="wchip">⛃ {{ s.widget }}</span>
                <label class="dec"><input type="checkbox" [ngModel]="s.decision" (ngModelChange)="patch(i, { decision: $event })" /> decision</label>
                <button class="rm" type="button" (click)="remove(i)" aria-label="Remove">✕</button>
              </div>
              @if (s.decision) {
                <div class="branches">
                  @for (br of s.branches; track $index; let bi = $index) {
                    <div class="branch">
                      <span class="when">when</span>
                      <input class="input f" [ngModel]="br.field" (ngModelChange)="patchBranch(i, bi, { field: $event })" placeholder="field" />
                      <select class="input o" [ngModel]="br.op" (ngModelChange)="patchBranch(i, bi, { op: $event })">
                        @for (o of ops; track o) { <option [value]="o">{{ o }}</option> }
                      </select>
                      @if (br.op !== 'truthy' && br.op !== 'falsy') {
                        <input class="input v" [ngModel]="br.value" (ngModelChange)="patchBranch(i, bi, { value: $event })" placeholder="value" />
                      }
                      <span class="arr">→</span>
                      <select class="input g" [ngModel]="br.goto" (ngModelChange)="patchBranch(i, bi, { goto: $event })">
                        <option value="" disabled>go to…</option>
                        @for (t of steps(); track t.id) { <option [value]="t.id">{{ t.section || t.id }}</option> }
                      </select>
                      <button class="rm sm" type="button" (click)="removeBranch(i, bi)">✕</button>
                    </div>
                  }
                  <div class="branch">
                    <span class="when">else →</span>
                    <select class="input g" [ngModel]="s.defaultNext" (ngModelChange)="patch(i, { defaultNext: $event })">
                      <option value="">End</option>
                      @for (t of steps(); track t.id) { <option [value]="t.id">{{ t.section || t.id }}</option> }
                    </select>
                    <button class="btn btn-ghost btn-sm" type="button" (click)="addBranch(i)">+ Branch</button>
                  </div>
                </div>
              }
            </div>
          }
        </div>

        <div class="preview card card-pad">
          <div class="eyebrow" style="margin-bottom:var(--s3)">Live journey</div>
          @if (resolved().length) { <aes-journey-flow [steps]="resolved()" /> }
          @else { <div class="muted" style="font-size:var(--fs-sm)">Add steps to see the journey.</div> }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .back { display:inline-flex; align-items:center; gap:var(--s1); color:var(--text-muted); font-size:var(--fs-sm); text-decoration:none; }
    .back:hover { color:var(--text); }
    .designer { display:grid; grid-template-columns: 240px minmax(0, 1fr) minmax(360px, 460px); gap:var(--s4); align-items:start; }
    @media (max-width:1000px){ .designer { grid-template-columns:1fr; } }
    .palette, .preview { position: sticky; top: var(--s4); max-height: calc(100vh - var(--s6)); overflow-y: auto; }
    @media (max-width:1000px){ .palette, .preview { position: static; max-height: none; } }
    .palette .pal-list { display:flex; flex-direction:column; gap:6px; margin-top:var(--s3); max-height:62vh; overflow-y:auto; }
    .pal-item { display:flex; align-items:center; gap:8px; padding:8px 10px; border:1px solid var(--border); border-radius:var(--r-sm);
      background:var(--surface-2); font-size:var(--fs-sm); font-family:var(--font-mono); cursor:grab; }
    .pal-item:hover { border-color:var(--brand); color:var(--brand); } .pal-item .kind { margin-left:auto; font-size:10px; opacity:.6; }
    .grip { color:var(--text-faint); letter-spacing:-2px; }
    .canvas { min-height:280px; display:flex; flex-direction:column; gap:var(--s2); }
    .drop-empty { border:2px dashed var(--border); border-radius:var(--r-md); padding:var(--s6); text-align:center; color:var(--text-muted); font-size:var(--fs-sm); }
    .step { border:1px solid var(--border); border-radius:var(--r-sm); padding:8px; background:var(--surface); }
    .step.decision { border-color:var(--warn-border); background:var(--warn-soft); }
    .srow { display:flex; align-items:center; gap:var(--s2); }
    .num { width:24px; height:24px; border-radius:50%; background:var(--brand-soft); color:var(--brand); display:grid; place-items:center; font-size:var(--fs-xs); font-weight:650; flex:none; }
    .step.decision .num { background:var(--warn-soft); color:var(--warn); }
    .srow .flex { flex:1; min-width:0; } .srow .input { padding:7px 9px; font-size:var(--fs-sm); }
    .wchip { font-family:var(--font-mono); font-size:10px; color:var(--brand); background:var(--brand-soft); padding:2px 7px; border-radius:var(--r-full); white-space:nowrap; }
    .dec { display:inline-flex; align-items:center; gap:5px; font-size:var(--fs-xs); color:var(--text-muted); white-space:nowrap; }
    .rm { border:1px solid var(--border); background:var(--surface); border-radius:var(--r-sm); width:26px; height:26px; cursor:pointer; color:var(--text-muted); }
    .rm:hover { border-color:var(--danger); color:var(--danger); } .rm.sm { width:22px; height:22px; }
    .branches { display:flex; flex-direction:column; gap:5px; margin:8px 0 2px 34px; }
    .branch { display:flex; align-items:center; gap:5px; flex-wrap:wrap; font-size:var(--fs-sm); }
    .branch .input { padding:5px 7px; font-size:var(--fs-xs); } .branch .f{width:90px} .branch .o{width:64px} .branch .v{width:80px} .branch .g{width:130px}
    .when { font-size:var(--fs-xs); color:var(--text-muted); } .arr { color:var(--warn); }
  `],
})
export class WorkflowDesignerComponent {
  private readonly catalog = inject(CapabilityCatalogService);
  private readonly toast = inject(ToastService);

  readonly id = input.required<string>();
  readonly ops = OPS;

  readonly wf = signal<Capability | null>(null);
  readonly steps = signal<Step[]>([]);
  readonly widgets = signal<readonly Capability[]>([]);
  readonly saving = signal(false);
  readonly drag = signal<{ kind: 'palette'; widget: string } | { kind: 'step'; index: number } | null>(null);
  q = '';

  readonly palette = computed(() => {
    const query = this.q.trim().toLowerCase();
    return this.widgets().filter((c) => !query || c.name.toLowerCase().includes(query));
  });

  /** Resolve drafts → JourneyFlowStep[] (next auto-chains, or encodes branches). */
  readonly resolved = computed<JourneyFlowStep[]>(() => {
    const s = this.steps();
    return s.map((st, i) => ({
      id: st.id,
      widget: st.widget,
      section: st.section,
      next: st.decision
        ? {
            branches: st.branches.filter((b) => b.goto).map((b) => ({
              when: { field: b.field, op: b.op, ...(b.op === 'truthy' || b.op === 'falsy' ? {} : { value: coerce(b.value) }) },
              goto: b.goto,
            })),
            default: st.defaultNext || null,
          }
        : (s[i + 1]?.id ?? null),
    }));
  });

  constructor() { queueMicrotask(() => this.load()); }

  private load(): void {
    this.catalog.get(this.id()).subscribe({
      next: (c) => {
        this.wf.set(c);
        const body = c.body as { workflow?: { steps?: unknown[] }; steps?: unknown[] };
        const raw = (body.workflow?.steps ?? body.steps ?? []) as Array<Record<string, unknown>>;
        this.steps.set(raw.map((r, i) => this.fromRaw(r, i)));
      },
      error: () => this.toast.error('Load failed', 'Could not load the workflow.'),
    });
    this.catalog.listByKind('component').subscribe({ next: (r) => this.widgets.update((w) => [...w, ...r.items]), error: () => {} });
    this.catalog.listByKind('form').subscribe({ next: (r) => this.widgets.update((w) => [...w, ...r.items]), error: () => {} });
  }

  private fromRaw(r: Record<string, unknown>, i: number): Step {
    const next = r['next'];
    const decision = !!next && typeof next === 'object' && Array.isArray((next as { branches?: unknown }).branches);
    const cn = decision ? (next as { branches: Array<{ when: { field: string; op: Branch['op']; value?: unknown }; goto: string }>; default: string | null }) : null;
    return {
      id: (r['id'] as string) ?? `s${i + 1}`,
      section: (r['section'] as string) ?? (r['id'] as string) ?? `Step ${i + 1}`,
      widget: (r['widget'] as string) ?? '',
      decision,
      branches: cn ? cn.branches.map((b) => ({ field: b.when.field, op: b.when.op, value: b.when.value == null ? '' : String(b.when.value), goto: b.goto })) : [],
      defaultNext: cn?.default ?? '',
    };
  }

  // drag + drop
  allow(e: DragEvent): void { e.preventDefault(); }
  startPaletteDrag(widget: string): void { this.drag.set({ kind: 'palette', widget }); }
  startStepDrag(index: number, e: DragEvent): void { e.stopPropagation(); this.drag.set({ kind: 'step', index }); }
  dropOnCanvas(e: DragEvent): void { e.preventDefault(); const d = this.drag(); if (d?.kind === 'palette') this.insert(this.steps().length, d.widget); this.drag.set(null); }
  dropOnStep(target: number, e: DragEvent): void {
    e.preventDefault(); e.stopPropagation();
    const d = this.drag();
    if (d?.kind === 'palette') this.insert(target, d.widget);
    else if (d?.kind === 'step') this.move(d.index, target);
    this.drag.set(null);
  }

  private insert(at: number, widget: string): void {
    this.steps.update((s) => { const next = [...s]; next.splice(at, 0, { id: this.newId(s), section: humanize(widget), widget, decision: false, branches: [], defaultNext: '' }); return next; });
  }
  private move(from: number, to: number): void { if (from === to) return; this.steps.update((s) => { const n = [...s]; const [x] = n.splice(from, 1); n.splice(to, 0, x!); return n; }); }
  patch(i: number, part: Partial<Step>): void { this.steps.update((s) => s.map((st, idx) => (idx === i ? { ...st, ...part, ...(part.decision && !st.branches.length ? { branches: [{ field: '', op: '==', value: '', goto: '' }] } : {}) } : st))); }
  remove(i: number): void { this.steps.update((s) => s.filter((_, idx) => idx !== i)); }
  addBranch(i: number): void { this.steps.update((s) => s.map((st, idx) => (idx === i ? { ...st, branches: [...st.branches, { field: '', op: '==', value: '', goto: '' }] } : st))); }
  removeBranch(i: number, bi: number): void { this.steps.update((s) => s.map((st, idx) => (idx === i ? { ...st, branches: st.branches.filter((_, x) => x !== bi) } : st))); }
  patchBranch(i: number, bi: number, part: Partial<Branch>): void {
    this.steps.update((s) => s.map((st, idx) => (idx === i ? { ...st, branches: st.branches.map((b, x) => (x === bi ? { ...b, ...part } : b)) } : st)));
  }
  private newId(s: readonly Step[]): string { let n = s.length + 1; const ids = new Set(s.map((x) => x.id)); while (ids.has(`s${n}`)) n++; return `s${n}`; }

  save(): void {
    const wf = this.wf();
    if (!wf) return;
    this.saving.set(true);
    const body = { ...wf.body, workflow: { steps: this.resolved() } };
    delete (body as Record<string, unknown>)['steps']; // canonicalize on workflow.steps
    this.catalog.update(wf.id, { body }).subscribe({
      next: () => { this.saving.set(false); this.toast.success('Workflow saved', `“${wf.name}” updated.`); },
      error: () => { this.saving.set(false); this.toast.error('Save failed', 'Could not save the workflow.'); },
    });
  }
}

function coerce(v: string): unknown {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}
function humanize(s: string): string { return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()); }
