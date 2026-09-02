import { ChangeDetectionStrategy, Component, computed, HostListener, inject, input, signal } from '@angular/core';
import { wireDesignerLiveSync } from './designer-live-sync';
import { CdkDrag, CdkDragHandle, CdkDropList, type CdkDragDrop } from '@angular/cdk/drag-drop';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { CodeViewComponent } from '../components/code-view.component';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CapabilityCatalogService, type Capability } from '../services/capability-catalog.service';
import { ToastService } from '../services/toast.service';
import { JourneyFlowComponent, type JourneyFlowStep } from '../journey-flow.component';
import { validateWorkflow } from './workflow-validate';
import { LifecycleBarComponent, type BarAction } from '../lifecycle-bar.component';
import { HistoryPanelComponent } from '../history-panel.component';
import { applyCapability, canApproveWith, handleBarAction, reportWriteError, type GovState } from '../governance-actions';
import { AuthService } from '../services/auth.service';
import type { ApprovalState } from '../services/capability-catalog.service';
import type { Lifecycle } from '../lifecycle';
import type { HasUnsavedChanges } from '../guards/unsaved-changes.guard';

/**
 * Drag-and-drop Workflow / Experience designer — the HIERARCHY case. The
 * Component + Form registries are the palette; dragging one appends a step that
 * renders it (lateral sequence). A step can become a ◇ decision with branches
 * (when field op value → goto) — the hierarchy. The canvas IS the workflow's
 * `steps[]` JSON: `next` auto-chains by order for linear steps, or encodes a
 * ConditionalNext for decisions. Live JourneyFlow preview; saves to the workflow.
 */
interface Branch { field: string; op: '==' | '!=' | 'in' | 'truthy' | 'falsy'; value: string; goto: string; }
/** One decision-output case: when the chosen output equals `value`, go to `goto`. */
interface Case { value: string; goto: string; }
interface Step {
  id: string; section: string; widget: string; decision: boolean;
  /** How a branching step decides: on aggregated state fields, or on a governed decision. */
  mode: 'state' | 'decision';
  branches: Branch[]; defaultNext: string;
  /** Governed-decision mode: the decision capability, which output to read, and the value→step cases. */
  decisionRef: string; output: string; cases: Case[];
}
const OPS = ['==', '!=', 'in', 'truthy', 'falsy'] as const;

@Component({
  selector: 'aes-workflow-designer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatProgressSpinnerModule, FormsModule, RouterLink, JourneyFlowComponent, LifecycleBarComponent, HistoryPanelComponent, CdkDropList, CdkDrag, CdkDragHandle, MatTooltipModule, MatButtonModule, MatIconModule, MatChipsModule, MatButtonToggleModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatCheckboxModule, CodeViewComponent],
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
        <div style="display:flex; gap:var(--s3); align-items:center">
          <aes-lifecycle-bar [lifecycle]="lifecycle()" [approvalState]="approvalState()" [canApprove]="canApprove()"
            [busy]="saving()" (action)="onBarAction($event)" (history)="showHistory.set(true)" />
          <button matButton="filled" type="button" (click)="save()" [disabled]="saving()">
            @if (saving()) { <mat-spinner diameter="16" class="btn-spin" aria-hidden="true"></mat-spinner> Saving… } @else { Save workflow }
          </button>
        </div>
      </div>

      @if (issues().length) {
        <div class="issues card card-pad" [class.has-err]="errorCount() > 0">
          <div class="eyebrow">Validation · {{ errorCount() }} error{{ errorCount() === 1 ? '' : 's' }}, {{ warnCount() }} warning{{ warnCount() === 1 ? '' : 's' }}</div>
          <ul>
            @for (iss of issues(); track $index) {
              <li [class.err]="iss.level === 'error'"><mat-icon class="dot">{{ iss.level === 'error' ? 'error' : 'warning' }}</mat-icon> {{ iss.message }}</li>
            }
          </ul>
        </div>
      }

      <div class="designer">
        <aside class="palette card card-pad">
          <div class="eyebrow" style="margin-bottom:var(--s2)">Components &amp; forms</div>
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af" style="width:100%">
            <mat-label>Search…</mat-label>
            <input matInput [(ngModel)]="q" autocomplete="off" />
          </mat-form-field>
          <div class="pal-list" cdkDropList id="wf-palette" [cdkDropListData]="paletteSource"
               [cdkDropListConnectedTo]="['wf-canvas']" [cdkDropListSortingDisabled]="true">
            @for (c of palette(); track c.name) {
              <div class="pal-item" cdkDrag [cdkDragData]="c.name">
                <mat-icon class="grip">drag_indicator</mat-icon> {{ c.name }} <span class="kind">{{ c.kind }}</span>
              </div>
            }
          </div>
        </aside>

        <div class="canvas card card-pad" cdkDropList id="wf-canvas" [cdkDropListData]="steps()" (cdkDropListDropped)="onDrop($event)">
          <div class="eyebrow rowbar" style="margin-bottom:var(--s3)">
            <span>Canvas · {{ steps().length }} step{{ steps().length === 1 ? '' : 's' }}</span>
            <span class="hbtns">
              <button type="button" class="hb" (click)="undo()" [disabled]="!canUndo()" matTooltip="Undo (⌘Z)" aria-label="Undo"><mat-icon>undo</mat-icon></button>
              <button type="button" class="hb" (click)="redo()" [disabled]="!canRedo()" matTooltip="Redo (⌘⇧Z)" aria-label="Redo"><mat-icon>redo</mat-icon></button>
            </span>
          </div>
          @if (!steps().length) { <div class="drop-empty">Drag components here to add steps.</div> }
          @for (s of steps(); track s.id; let i = $index) {
            <div class="step" [class.decision]="s.decision" cdkDrag [cdkDragData]="i">
              <div class="srow">
                <mat-icon class="grip" cdkDragHandle>drag_indicator</mat-icon>
                <span class="num">{{ s.decision ? '◇' : i + 1 }}</span>
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af flex">
                  <mat-label>Step title</mat-label>
                  <input matInput [ngModel]="s.section" (ngModelChange)="patch(i, { section: $event })" />
                </mat-form-field>
                <mat-chip-set class="wchip-set"><mat-chip class="wchip"><mat-icon matChipAvatar>widgets</mat-icon>{{ s.widget }}</mat-chip></mat-chip-set>
                <mat-checkbox [ngModel]="s.decision" (ngModelChange)="patch(i, { decision: $event })">decision</mat-checkbox>
                <button class="rm" type="button" (click)="remove(i)" aria-label="Remove"><mat-icon>close</mat-icon></button>
              </div>
              @if (s.decision) {
                <div class="branches">
                  <div class="branch">
                    <span class="when">branch on</span>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af o">
                      <mat-select [ngModel]="s.mode" (ngModelChange)="patch(i, { mode: $event })">
                        <mat-option value="state">state fields</mat-option>
                        <mat-option value="decision">a decision</mat-option>
                      </mat-select>
                    </mat-form-field>
                    @if (s.mode === 'decision') {
                      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af g">
                        <mat-label>Decision</mat-label>
                        <mat-select [ngModel]="s.decisionRef" (ngModelChange)="patch(i, { decisionRef: $event })">
                          @for (d of decisions(); track d.name) { <mat-option [value]="d.name"><mat-icon class="opt-ic">rule</mat-icon> {{ d.name }}</mat-option> }
                        </mat-select>
                      </mat-form-field>
                      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af f">
                        <mat-label>Output</mat-label>
                        <input matInput [ngModel]="s.output" (ngModelChange)="patch(i, { output: $event })" placeholder="opt" />
                      </mat-form-field>
                    }
                  </div>
                </div>
                }
                @if (s.decision && s.mode === 'decision') {
                <div class="branches">
                  @for (c of s.cases; track $index; let ci = $index) {
                    <div class="branch">
                      <span class="when">when =</span>
                      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af v">
                        <mat-label>value</mat-label>
                        <input matInput [ngModel]="c.value" (ngModelChange)="patchCase(i, ci, { value: $event })" />
                      </mat-form-field>
                      <span class="arr">→</span>
                      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af g">
                        <mat-label>go to</mat-label>
                        <mat-select [ngModel]="c.goto" (ngModelChange)="patchCase(i, ci, { goto: $event })">
                          @for (t of steps(); track t.id) { <mat-option [value]="t.id">{{ t.section || t.id }}</mat-option> }
                        </mat-select>
                      </mat-form-field>
                      <button class="rm sm" type="button" (click)="removeCase(i, ci)"><mat-icon>close</mat-icon></button>
                    </div>
                  }
                  <div class="branch">
                    <span class="when">else →</span>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af g">
                      <mat-label>default</mat-label>
                      <mat-select [ngModel]="s.defaultNext" (ngModelChange)="patch(i, { defaultNext: $event })">
                        <mat-option value="">End</mat-option>
                        @for (t of steps(); track t.id) { <mat-option [value]="t.id">{{ t.section || t.id }}</mat-option> }
                      </mat-select>
                    </mat-form-field>
                    <button matButton type="button" (click)="addCase(i)">+ Case</button>
                  </div>
                </div>
                }
                @if (s.decision && s.mode !== 'decision') {
                <div class="branches">
                  @for (br of s.branches; track $index; let bi = $index) {
                    <div class="branch">
                      <span class="when">when</span>
                      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af f">
                        <mat-label>field</mat-label>
                        <input matInput [ngModel]="br.field" (ngModelChange)="patchBranch(i, bi, { field: $event })" />
                      </mat-form-field>
                      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af o">
                        <mat-select [ngModel]="br.op" (ngModelChange)="patchBranch(i, bi, { op: $event })">
                          @for (o of ops; track o) { <mat-option [value]="o">{{ o }}</mat-option> }
                        </mat-select>
                      </mat-form-field>
                      @if (br.op !== 'truthy' && br.op !== 'falsy') {
                        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af v">
                          <mat-label>value</mat-label>
                          <input matInput [ngModel]="br.value" (ngModelChange)="patchBranch(i, bi, { value: $event })" />
                        </mat-form-field>
                      }
                      <span class="arr">→</span>
                      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af g">
                        <mat-label>go to</mat-label>
                        <mat-select [ngModel]="br.goto" (ngModelChange)="patchBranch(i, bi, { goto: $event })">
                          @for (t of steps(); track t.id) { <mat-option [value]="t.id">{{ t.section || t.id }}</mat-option> }
                        </mat-select>
                      </mat-form-field>
                      <button class="rm sm" type="button" (click)="removeBranch(i, bi)"><mat-icon>close</mat-icon></button>
                    </div>
                  }
                  <div class="branch">
                    <span class="when">else →</span>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic" class="af g">
                      <mat-label>default</mat-label>
                      <mat-select [ngModel]="s.defaultNext" (ngModelChange)="patch(i, { defaultNext: $event })">
                        <mat-option value="">End</mat-option>
                        @for (t of steps(); track t.id) { <mat-option [value]="t.id">{{ t.section || t.id }}</mat-option> }
                      </mat-select>
                    </mat-form-field>
                    <button matButton type="button" (click)="addBranch(i)">+ Branch</button>
                  </div>
                </div>
              }
            </div>
          }
        </div>

        <div class="preview card card-pad">
          <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:var(--s3)">
            <div class="eyebrow" style="margin-bottom:0">{{ previewMode() === 'code' ? 'Workflow JSON' : 'Live journey' }}</div>
            <mat-button-toggle-group [value]="previewMode()" (change)="previewMode.set($event.value)"
              hideSingleSelectionIndicator aria-label="Preview mode" style="--mat-standard-button-toggle-height:30px; font-size:12px">
              <mat-button-toggle value="flow" matTooltip="Journey diagram">Journey</mat-button-toggle>
              <mat-button-toggle value="code" matTooltip="View the workflow JSON">Code</mat-button-toggle>
            </mat-button-toggle-group>
          </div>
          @if (previewMode() === 'code') {
            <aes-code-view [value]="currentBody()" [label]="wf()?.name ?? 'workflow'" />
          } @else if (resolved().length) { <aes-journey-flow [steps]="resolved()" /> }
          @else { <div class="muted" style="font-size:var(--fs-sm)">Add steps to see the journey.</div> }
        </div>
      </div>
      @if (showHistory()) { <aes-history-panel [capabilityId]="id()" (close)="showHistory.set(false)" (changed)="reload()" /> }
    </div>
  `,
  styles: [`
    .btn-spin { --mdc-circular-progress-active-indicator-color: currentColor; display:inline-block; vertical-align:middle; margin-right:6px; }
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
    .grip { color:var(--text-faint); font-size:18px; width:18px; height:18px; }
    .canvas { min-height:280px; display:flex; flex-direction:column; gap:var(--s2); }
    .drop-empty { border:2px dashed var(--border); border-radius:var(--r-md); padding:var(--s6); text-align:center; color:var(--text-muted); font-size:var(--fs-sm); }
    .step { border:1px solid var(--border); border-radius:var(--r-sm); padding:8px; background:var(--surface); }
    .step.decision { border-color:var(--warn-border); background:var(--warn-soft); }
    .srow { display:flex; align-items:center; gap:var(--s2); }
    .num { width:24px; height:24px; border-radius:50%; background:var(--brand-soft); color:var(--brand); display:grid; place-items:center; font-size:var(--fs-xs); font-weight:650; flex:none; }
    .step.decision .num { background:var(--warn-soft); color:var(--warn); }
    .srow .flex { flex:1; min-width:0; } .srow .input { padding:7px 9px; font-size:var(--fs-sm); }
    .wchip-set { display:inline-flex; }
    .wchip.mat-mdc-chip { --mdc-chip-container-height:22px; --mdc-chip-elevated-container-color:var(--brand-soft); --mdc-chip-label-text-color:var(--brand);
      font-family:var(--font-mono); font-size:10px; }
    .wchip .mat-mdc-chip-avatar { font-size:13px; width:13px; height:13px; color:var(--brand); }
    .dec { display:inline-flex; align-items:center; gap:5px; font-size:var(--fs-xs); color:var(--text-muted); white-space:nowrap; }
    .rm { border:1px solid var(--border); background:var(--surface); border-radius:var(--r-sm); width:26px; height:26px; cursor:pointer; color:var(--text-muted); }
    .rm:hover { border-color:var(--danger); color:var(--danger); } .rm.sm { width:22px; height:22px; }
    /* CDK drag-drop states + undo toolbar (Studio-token styled). */
    .step.cdk-drag-preview { box-shadow:0 8px 24px -8px rgba(0,0,0,.35); border-color:var(--brand); background:var(--surface); }
    .step.cdk-drag-placeholder { opacity:.35; border-style:dashed; }
    .grip[cdkdraghandle] { cursor:grab; } .step.cdk-drag-dragging .grip { cursor:grabbing; }
    .canvas.cdk-drop-list-dragging { outline:1px dashed var(--brand); outline-offset:2px; }
    .cdk-drag-animating { transition:transform .18s cubic-bezier(0,0,.2,1); }
    .rowbar { display:flex; align-items:center; justify-content:space-between; gap:10px; }
    .hbtns { display:inline-flex; gap:4px; }
    .hb { border:1px solid var(--border); background:var(--surface); color:var(--text-muted); border-radius:var(--r-sm); width:26px; height:24px; font-size:14px; line-height:1; cursor:pointer; }
    .hb:hover:not([disabled]) { border-color:var(--brand); color:var(--brand); }
    .hb[disabled] { opacity:.35; cursor:default; }
    .branches { display:flex; flex-direction:column; gap:5px; margin:8px 0 2px 34px; }
    .branch { display:flex; align-items:center; gap:5px; flex-wrap:wrap; font-size:var(--fs-sm); }
    .branch .input { padding:5px 7px; font-size:var(--fs-xs); } .branch .f{width:90px} .branch .o{width:64px} .branch .v{width:80px} .branch .g{width:130px}
    .when { font-size:var(--fs-xs); color:var(--text-muted); } .arr { color:var(--warn); }
    .issues { margin:var(--s3) 0 0; border-left:3px solid var(--warn); }
    .issues.has-err { border-left-color:var(--danger); }
    .issues ul { list-style:none; margin:var(--s2) 0 0; padding:0; display:flex; flex-direction:column; gap:4px; }
    .issues li { font-size:var(--fs-sm); color:var(--warn); display:flex; gap:7px; align-items:baseline; }
    .issues li.err { color:var(--danger); }
    .issues .dot { font-size:15px; width:15px; height:15px; vertical-align:middle; color:var(--warn); }
    .issues li.err .dot { color:var(--danger); }
    .rm, .hb { display:inline-grid; place-items:center; }
    .rm mat-icon, .hb mat-icon { font-size:15px; width:15px; height:15px; }
  `],
})
export class WorkflowDesignerComponent implements HasUnsavedChanges {
  private readonly catalog = inject(CapabilityCatalogService);
  private readonly toast = inject(ToastService);

  readonly id = input.required<string>();
  readonly ops = OPS;

  readonly wf = signal<Capability | null>(null);
  readonly steps = signal<Step[]>([]);
  readonly widgets = signal<readonly Capability[]>([]);
  /** Governed decisions a step can branch on (◆). */
  readonly decisions = signal<readonly Capability[]>([]);
  readonly saving = signal(false);
  readonly lifecycle = signal<Lifecycle>('draft');
  readonly approvalState = signal<ApprovalState>('draft');
  readonly capVersion = signal(0);
  readonly showHistory = signal(false);
  private readonly auth = inject(AuthService);
  readonly canApprove = computed(() => canApproveWith(this.auth.roles()));
  private pristine = '';
  q = '';

  readonly palette = computed(() => {
    const query = this.q.trim().toLowerCase();
    return this.widgets().filter((c) => !query || c.name.toLowerCase().includes(query));
  });

  /** Static validation of the resolved graph (dead targets, unreachable, loops). */
  readonly issues = computed(() => validateWorkflow(this.resolved()));
  readonly errorCount = computed(() => this.issues().filter((i) => i.level === 'error').length);
  readonly warnCount = computed(() => this.issues().filter((i) => i.level === 'warn').length);

  /** Preview mode: the journey diagram, or the workflow JSON body. */
  protected readonly previewMode = signal<'flow' | 'code'>('flow');
  /** The workflow body as it would be saved — drives the Code preview. */
  protected readonly currentBody = computed<Record<string, unknown>>(() => {
    const base = { ...(this.wf()?.body ?? {}) } as Record<string, unknown>;
    delete base['steps']; // canonicalize on workflow.steps
    return { ...base, workflow: { steps: this.resolved() } };
  });

  /** Resolve drafts → JourneyFlowStep[] (next auto-chains, or encodes branches). */
  readonly resolved = computed<JourneyFlowStep[]>(() => {
    const s = this.steps();
    return s.map((st, i) => ({
      id: st.id,
      widget: st.widget,
      section: st.section,
      next: st.decision
        ? (st.mode === 'decision' && st.decisionRef
            ? {
                decision: st.decisionRef,
                ...(st.output ? { output: st.output } : {}),
                cases: Object.fromEntries(st.cases.filter((c) => c.value && c.goto).map((c) => [c.value, c.goto])),
                default: st.defaultNext || null,
              }
            : {
                branches: st.branches.filter((b) => b.goto).map((b) => ({
                  when: { field: b.field, op: b.op, ...(b.op === 'truthy' || b.op === 'falsy' ? {} : { value: coerce(b.value) }) },
                  goto: b.goto,
                })),
                default: st.defaultNext || null,
              })
        : (s[i + 1]?.id ?? null),
    }));
  });

  constructor() { wireDesignerLiveSync({ id: () => this.id(), reload: () => this.reload(), isDirty: () => this.hasUnsavedChanges() }); }

  private load(): void {
    this.catalog.get(this.id()).subscribe({
      next: (c) => {
        this.wf.set(c);
        const body = c.body as { workflow?: { steps?: unknown[] }; steps?: unknown[] };
        const raw = (body.workflow?.steps ?? body.steps ?? []) as Array<Record<string, unknown>>;
        this.steps.set(raw.map((r, i) => this.fromRaw(r, i)));
        this.past.set([]); this.future.set([]); // fresh undo history from the loaded workflow
        applyCapability(this.gov(), c);
        this.pristine = this.snapshot();
      },
      error: () => this.toast.error('Load failed', 'Could not load the workflow.'),
    });
    this.catalog.listByKind('component').subscribe({ next: (r) => this.widgets.update((w) => [...w, ...r.items]), error: () => {} });
    this.catalog.listByKind('form').subscribe({ next: (r) => this.widgets.update((w) => [...w, ...r.items]), error: () => {} });
    this.catalog.listByKind('decision').subscribe({ next: (r) => this.decisions.set(r.items), error: () => {} });
  }

  private fromRaw(r: Record<string, unknown>, i: number): Step {
    const next = r['next'];
    const obj = !!next && typeof next === 'object' ? (next as Record<string, unknown>) : null;
    const governed = !!obj && typeof obj['decision'] === 'string';
    const stateBranch = !!obj && Array.isArray(obj['branches']);
    const cn = stateBranch ? (obj as unknown as { branches: Array<{ when: { field: string; op: Branch['op']; value?: unknown }; goto: string }>; default: string | null }) : null;
    const dn = governed ? (obj as unknown as { decision: string; output?: string; cases?: Record<string, string>; default: string | null }) : null;
    return {
      id: (r['id'] as string) ?? `s${i + 1}`,
      section: (r['section'] as string) ?? (r['id'] as string) ?? `Step ${i + 1}`,
      widget: (r['widget'] as string) ?? '',
      decision: governed || stateBranch,
      mode: governed ? 'decision' : 'state',
      branches: cn ? cn.branches.map((b) => ({ field: b.when.field, op: b.when.op, value: b.when.value == null ? '' : String(b.when.value), goto: b.goto })) : [],
      defaultNext: dn?.default ?? cn?.default ?? '',
      decisionRef: dn?.decision ?? '',
      output: dn?.output ?? '',
      cases: dn?.cases ? Object.entries(dn.cases).map(([value, goto]) => ({ value, goto: String(goto) })) : [],
    };
  }

  // ── drag + drop (CDK) — reorder within the canvas, or copy from the palette ──
  protected readonly paletteSource: readonly string[] = [];
  protected onDrop(event: CdkDragDrop<Step[]>): void {
    if (event.previousContainer === event.container) this.move(event.previousIndex, event.currentIndex);
    else this.insert(event.currentIndex, event.item.data as string);
  }

  // ── undo / redo over steps() (structural edits: add / move / remove) ─────────
  private readonly past = signal<Step[][]>([]);
  private readonly future = signal<Step[][]>([]);
  readonly canUndo = computed(() => this.past().length > 0);
  readonly canRedo = computed(() => this.future().length > 0);
  private pushHistory(): void { this.past.update((h) => [...h.slice(-49), this.steps()]); this.future.set([]); }
  undo(): void {
    const h = this.past();
    if (!h.length) return;
    this.future.update((f) => [this.steps(), ...f]);
    this.past.set(h.slice(0, -1));
    this.steps.set(h[h.length - 1]!);
  }
  redo(): void {
    const f = this.future();
    if (!f.length) return;
    this.past.update((p) => [...p, this.steps()]);
    this.future.set(f.slice(1));
    this.steps.set(f[0]!);
  }
  @HostListener('document:keydown', ['$event'])
  protected onKey(e: KeyboardEvent): void {
    const el = e.target as HTMLElement | null;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); this.redo(); }
  }

  private insert(at: number, widget: string): void {
    this.pushHistory();
    this.steps.update((s) => { const next = [...s]; next.splice(at, 0, { id: this.newId(s), section: humanize(widget), widget, decision: false, mode: 'state', branches: [], defaultNext: '', decisionRef: '', output: '', cases: [] }); return next; });
  }
  private move(from: number, to: number): void { if (from === to) return; this.pushHistory(); this.steps.update((s) => { const n = [...s]; const [x] = n.splice(from, 1); n.splice(to, 0, x!); return n; }); }
  patch(i: number, part: Partial<Step>): void {
    this.steps.update((s) => s.map((st, idx) => {
      if (idx !== i) return st;
      const merged: Step = { ...st, ...part };
      // Seed a first row when a step becomes branching, matching its mode.
      if ((part.decision || part.mode) && merged.decision) {
        if (merged.mode === 'decision' && !merged.cases.length) merged.cases = [{ value: '', goto: '' }];
        if (merged.mode !== 'decision' && !merged.branches.length) merged.branches = [{ field: '', op: '==', value: '', goto: '' }];
      }
      return merged;
    }));
  }
  addCase(i: number): void { this.steps.update((s) => s.map((st, idx) => (idx === i ? { ...st, cases: [...st.cases, { value: '', goto: '' }] } : st))); }
  removeCase(i: number, ci: number): void { this.steps.update((s) => s.map((st, idx) => (idx === i ? { ...st, cases: st.cases.filter((_, x) => x !== ci) } : st))); }
  patchCase(i: number, ci: number, part: Partial<Case>): void {
    this.steps.update((s) => s.map((st, idx) => (idx === i ? { ...st, cases: st.cases.map((c, x) => (x === ci ? { ...c, ...part } : c)) } : st)));
  }
  remove(i: number): void { this.pushHistory(); this.steps.update((s) => s.filter((_, idx) => idx !== i)); }
  addBranch(i: number): void { this.steps.update((s) => s.map((st, idx) => (idx === i ? { ...st, branches: [...st.branches, { field: '', op: '==', value: '', goto: '' }] } : st))); }
  removeBranch(i: number, bi: number): void { this.steps.update((s) => s.map((st, idx) => (idx === i ? { ...st, branches: st.branches.filter((_, x) => x !== bi) } : st))); }
  patchBranch(i: number, bi: number, part: Partial<Branch>): void {
    this.steps.update((s) => s.map((st, idx) => (idx === i ? { ...st, branches: st.branches.map((b, x) => (x === bi ? { ...b, ...part } : b)) } : st)));
  }
  private newId(s: readonly Step[]): string { let n = s.length + 1; const ids = new Set(s.map((x) => x.id)); while (ids.has(`s${n}`)) n++; return `s${n}`; }

  // ── governance + unsaved-changes guard ──────────────────────────────────────
  private snapshot(): string { return JSON.stringify(this.steps()); }
  hasUnsavedChanges(): boolean { return !!this.wf() && this.snapshot() !== this.pristine; }
  private gov(): GovState { return { lifecycle: this.lifecycle, approvalState: this.approvalState, version: this.capVersion }; }
  protected onBarAction(a: BarAction): void {
    const wf = this.wf();
    if (wf) handleBarAction(a, wf.id, this.gov(), this.catalog, this.toast);
  }
  protected reload(): void { this.widgets.set([]); this.load(); }

  save(): void {
    const wf = this.wf();
    if (!wf) return;
    this.saving.set(true);
    const body = { ...wf.body, workflow: { steps: this.resolved() } };
    delete (body as Record<string, unknown>)['steps']; // canonicalize on workflow.steps
    this.catalog.update(wf.id, { body }, this.capVersion()).subscribe({
      next: (c) => { this.saving.set(false); this.pristine = this.snapshot(); applyCapability(this.gov(), c); this.toast.success('Workflow saved', `“${wf.name}” updated.`); },
      error: (e) => { this.saving.set(false); reportWriteError(this.toast, e); },
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
