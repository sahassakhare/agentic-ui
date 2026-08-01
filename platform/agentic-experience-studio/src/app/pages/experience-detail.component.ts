import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  ExperienceCatalogService,
  type ApprovalAction,
  type Experience,
  type ExperiencePlanResult,
} from '../services/experience-catalog.service';
import { buildExperienceGraphElements, partitionGraph } from '../experience-graph';
import { formatRequirementLines, parseRequirementLines } from '../experience-form';
import { GraphViewComponent } from '../graph-view.component';
import { ToastService } from '../services/toast.service';
import { CapabilityCatalogService } from '../services/capability-catalog.service';
import { JourneyFlowComponent, type JourneyFlowStep } from '../journey-flow.component';

/**
 * Experience detail (AEP Seam E) — one experience, its capability dependency
 * graph (Seam A viz, edges coloured matched/unmet from a server `/plan`
 * dry-run), and the approval-workflow actions. Product-quality: skeleton load,
 * a graph legend, a plan stat strip, and toast feedback for every mutation.
 */
@Component({
  selector: 'aes-experience-detail',
  imports: [RouterLink, FormsModule, GraphViewComponent, JourneyFlowComponent],
  template: `
    <div class="page">
      <a routerLink="/experiences" class="back">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m15 6-6 6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Experiences
      </a>

      @if (loading()) {
        <div class="skeleton" style="height:40px; width:320px; margin:var(--s4) 0"></div>
        <div class="skeleton" style="height:220px; margin-top:var(--s4)"></div>
      } @else if (error() && !experience()) {
        <div class="empty" role="alert" style="margin-top:var(--s5)">
          <div class="empty-icon" style="background:var(--danger-soft);color:var(--danger)">!</div>
          <h3>Couldn’t load this experience</h3>
          <p class="muted">{{ error() }}</p>
          <a class="btn" routerLink="/experiences">Back to list</a>
        </div>
      } @else if (experience(); as e) {
        <div class="page-header" style="margin-top:var(--s4)">
          <div class="titles">
            <span class="eyebrow">Experience · {{ e.name }}</span>
            <div class="row" style="gap:var(--s3)">
              <h1>{{ e.title }}</h1>
              <span class="badge" [class]="badgeClass(e.approvalState)">{{ e.approvalState }}</span>
            </div>
            @if (!editing()) { <p class="subtitle" style="font-size:var(--fs-lg); color:var(--text)">{{ e.goal }}</p> }
          </div>
          <button class="btn" type="button" (click)="startEdit(e)">{{ editing() ? 'Cancel' : 'Edit' }}</button>
        </div>

        @if (editing()) {
          <form class="card card-pad" (ngSubmit)="save()" style="margin-bottom:var(--s5)">
            <div class="grid-2">
              <div class="field"><label class="label" for="ed-title">Title</label>
                <input class="input" id="ed-title" name="title" [(ngModel)]="editTitle" /></div>
              <div class="field"><label class="label" for="ed-goal">Goal</label>
                <input class="input" id="ed-goal" name="goal" [(ngModel)]="editGoal" /></div>
              <div class="field" style="grid-column:1 / -1"><label class="label" for="ed-req">Requirements</label>
                <textarea class="textarea" id="ed-req" name="req" rows="4" [(ngModel)]="editRequires"></textarea>
                <span class="help">One per line: <code>kind selector [optional]</code>.</span></div>
            </div>
            <div class="row" style="margin-top:var(--s5)">
              <button class="btn btn-primary" type="submit" [disabled]="saving()">
                @if (saving()) { <span class="spinner" aria-hidden="true"></span> Saving… } @else { Save changes }
              </button>
              <button class="btn btn-ghost" type="button" (click)="editing.set(false)">Cancel</button>
            </div>
          </form>
        }

        <!-- The journey (workflow) — the primary "what the end user experiences" view -->
        <section class="card card-pad journey">
          <div class="stack" style="gap:2px; margin-bottom:var(--s4)">
            <span class="eyebrow">The journey · end-user UX</span>
            <div class="row" style="gap:var(--s2)">
              <h2 style="font-size:var(--fs-lg)">{{ journeyWorkflow() ?? 'No journey defined' }}</h2>
              @if (journeyWorkflow()) { <span class="badge plain badge-warn">workflow</span> }
            </div>
            <span class="muted" style="font-size:var(--fs-sm)">The step-by-step path the end user takes — authored as a workflow, not the dependency graph.</span>
          </div>
          @if (journey().length) {
            <aes-journey-flow [steps]="journey()" />
          } @else if (journeyWorkflow()) {
            <p class="muted">Workflow “{{ journeyWorkflow() }}” isn’t in the catalog (or has no steps).</p>
          } @else {
            <div class="empty" style="border:0; padding:var(--s5)">
              <p>No user journey yet — add a <code>workflow</code> requirement to define the steps the end user walks through.</p>
              <button class="btn btn-ghost btn-sm" (click)="startEdit(e)">Edit requirements</button>
            </div>
          }
        </section>

        <!-- Approval + plan action bar -->
        <div class="card card-pad actionbar">
          <div class="stack" style="gap:2px">
            <span class="eyebrow">Approval workflow</span>
            <span class="muted" style="font-size:var(--fs-sm)">Only approved experiences are served by the runtime.</span>
          </div>
          <div class="row spacer" style="gap:var(--s2); flex-wrap:wrap; justify-content:flex-end">
            @for (a of actions(); track a) {
              <button class="btn btn-sm" type="button" [class.btn-primary]="a === 'approve'" [class.btn-danger]="a === 'reject' || a === 'revoke'"
                [disabled]="transitioning()" (click)="transition(a)" style="text-transform:capitalize">{{ a }}</button>
            }
            <button class="btn btn-primary btn-sm" type="button" (click)="runPlan()" [disabled]="planning()">
              @if (planning()) { <span class="spinner" aria-hidden="true"></span> Resolving… } @else { Resolve plan }
            </button>
          </div>
        </div>

        <!-- Plan stat strip -->
        @if (plan(); as p) {
          <div class="stats">
            <div class="stat"><span class="v">{{ p.matched.length }}</span><span class="k">matched</span></div>
            <div class="stat" [class.warn]="p.unmet.length > 0"><span class="v">{{ p.unmet.length }}</span><span class="k">unmet</span></div>
            <div class="stat" [class.ok]="p.complete" [class.bad]="!p.complete">
              <span class="v">{{ p.complete ? '✓' : '—' }}</span><span class="k">{{ p.complete ? 'resolvable' : 'incomplete' }}</span>
            </div>
          </div>
        }

        <!-- Dependency graph -->
        <section class="card" style="margin-top:var(--s5); overflow:hidden">
          <div class="card-pad" style="padding-bottom:var(--s3); display:flex; align-items:center; justify-content:space-between; gap:var(--s3); flex-wrap:wrap">
            <div class="stack" style="gap:2px">
              <h2 style="font-size:var(--fs-lg)">Composition &amp; health</h2>
              <span class="muted" style="font-size:var(--fs-sm)">What this experience is <em>made of</em> and whether it resolves — the parts list, not the journey.</span>
            </div>
            <div class="legend">
              <span><i class="dot root"></i>goal</span>
              <span><i class="dot matched"></i>matched</span>
              <span><i class="dot unmet"></i>unmet</span>
            </div>
          </div>
          @if (graph().nodes.length <= 1) {
            <div class="empty" style="margin:0 var(--s5) var(--s5); border:0; padding:var(--s6)">
              <p>No declared requirements yet. <button class="btn btn-ghost btn-sm" (click)="startEdit(e)">Add some</button></p>
            </div>
          } @else {
            <div style="padding:0 var(--s5)"><aes-graph-view [elements]="graphElements()" /></div>
            <ul class="nodes">
              @for (n of graph().nodes; track n.id) {
                <li class="node" [class]="n.state">
                  <span class="badge plain" [class.badge-info]="n.state==='root'" [class.badge-ok]="n.state==='matched'" [class.badge-danger]="n.state==='unmet'">{{ n.kind }}</span>
                  <span class="nlabel">{{ n.label }}</span>
                  <span class="nstate spacer">{{ n.state }}</span>
                </li>
              }
            </ul>
          }
        </section>
      }
    </div>
  `,
  styles: [`
    .back { display: inline-flex; align-items: center; gap: var(--s1); color: var(--text-muted); font-size: var(--fs-sm); text-decoration: none; }
    .back:hover { color: var(--text); text-decoration: none; }
    .actionbar { display: flex; align-items: center; gap: var(--s4); flex-wrap: wrap; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s3); margin-top: var(--s3); }
    .stat { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md); padding: var(--s4);
      display: flex; flex-direction: column; gap: 2px; }
    .stat .v { font-size: var(--fs-xl); font-weight: 650; font-variant-numeric: tabular-nums; line-height: 1; }
    .stat .k { font-size: var(--fs-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: .06em; font-family: var(--font-mono); }
    .stat.ok { border-color: var(--ok-border); background: var(--ok-soft); } .stat.ok .v { color: var(--ok); }
    .stat.bad .v { color: var(--text-faint); }
    .stat.warn .v { color: var(--warn); }
    .legend { display: flex; gap: var(--s4); font-size: var(--fs-xs); color: var(--text-muted); }
    .legend span { display: inline-flex; align-items: center; gap: var(--s1); }
    .legend .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
    .dot.root { background: var(--info); } .dot.matched { background: var(--ok); } .dot.unmet { background: var(--danger); }
    .nodes { list-style: none; margin: 0; padding: var(--s3) var(--s5) var(--s5); display: flex; flex-direction: column; gap: var(--s2); }
    .node { display: flex; align-items: center; gap: var(--s3); padding: var(--s3); border-radius: var(--r-sm);
      border: 1px solid var(--border); background: var(--surface); border-left: 3px solid var(--border-strong); }
    .node.root { border-left-color: var(--info); }
    .node.matched { border-left-color: var(--ok); }
    .node.unmet { border-left-color: var(--danger); background: var(--danger-soft); }
    .nlabel { font-weight: 550; }
    .nstate { font-size: var(--fs-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; font-family: var(--font-mono); }
    /* Journey (workflow) — the primary view */
    .journey { border-left: 3px solid var(--brand); }
    .steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0; }
    .jstep { position: relative; display: flex; align-items: flex-start; gap: var(--s3); padding: var(--s3) 0; }
    .jstep:not(.terminal)::after { content: ""; position: absolute; left: 15px; top: 34px; bottom: -6px; width: 2px; background: var(--border-strong); }
    .jnum { flex: none; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center;
      background: var(--brand-soft); color: var(--brand); font-weight: 650; font-size: var(--fs-sm); z-index: 1; }
    .jstep.terminal .jnum { background: var(--ok-soft); color: var(--ok); }
    .jbody { padding-top: 3px; }
    .jhead { font-weight: 600; }
    .jmeta { font-size: var(--fs-sm); color: var(--text-muted); }
    .jmeta code { color: var(--text); background: var(--surface-2); padding: 1px 6px; border-radius: 5px; font-size: .92em; }
  `],
})
export class ExperienceDetailComponent {
  private readonly catalog = inject(ExperienceCatalogService);
  private readonly toast = inject(ToastService);

  /** Bound from the route param via withComponentInputBinding(). */
  readonly id = input.required<string>();

  readonly experience = signal<Experience | null>(null);
  readonly plan = signal<ExperiencePlanResult | null>(null);
  readonly error = signal<string | null>(null);
  readonly loading = signal(true);
  readonly planning = signal(false);
  readonly transitioning = signal(false);

  readonly editing = signal(false);
  readonly saving = signal(false);
  editTitle = ''; editGoal = ''; editRequires = '';

  private readonly caps = inject(CapabilityCatalogService);
  /** The user journey — the steps of the workflow this experience requires. */
  readonly journey = signal<JourneyFlowStep[]>([]);
  readonly journeyWorkflow = signal<string | null>(null);
  /** Name of the workflow capability this experience requires (the journey). */
  private workflowRequirement(e: Experience): string | null {
    const req = (e.body.requires ?? []).find((r) => r.kind === 'workflow' && r.name);
    return req?.name ?? null;
  }

  readonly graphElements = computed(() => {
    const e = this.experience();
    return e ? buildExperienceGraphElements(e, this.plan() ?? undefined) : [];
  });
  readonly graph = computed(() => partitionGraph(this.graphElements()));

  readonly actions = computed<ApprovalAction[]>(() => {
    switch (this.experience()?.approvalState) {
      case 'draft': return ['submit', 'deprecate'];
      case 'review': return ['approve', 'reject', 'deprecate'];
      case 'rejected': return ['submit', 'deprecate'];
      case 'approved': return ['revoke', 'deprecate'];
      default: return [];
    }
  });

  constructor() { queueMicrotask(() => this.load()); }

  badgeClass(state: string): string {
    return state === 'approved' ? 'badge-ok'
      : state === 'review' ? 'badge-warn'
      : state === 'rejected' || state === 'deprecated' ? 'badge-danger'
      : 'badge-info';
  }

  private load(): void {
    this.loading.set(true);
    this.catalog.get(this.id()).subscribe({
      next: (e) => { this.experience.set(e); this.loading.set(false); this.loadJourney(e); },
      error: (err) => { this.error.set(message(err)); this.loading.set(false); },
    });
  }

  /** Fetch the required workflow capability and expose its steps as the journey. */
  private loadJourney(e: Experience): void {
    const name = this.workflowRequirement(e);
    this.journeyWorkflow.set(name);
    this.journey.set([]);
    if (!name) return;
    this.caps.listByKind('workflow').subscribe({
      next: (res) => {
        const wf = res.items.find((c) => c.name === name);
        const steps = (wf?.body?.['steps'] as JourneyFlowStep[] | undefined) ?? [];
        this.journey.set(steps);
      },
      error: () => this.journey.set([]),
    });
  }


  startEdit(e: Experience): void {
    if (this.editing()) { this.editing.set(false); return; }
    this.editTitle = e.title;
    this.editGoal = e.goal;
    this.editRequires = formatRequirementLines(e.body.requires);
    this.editing.set(true);
  }

  save(): void {
    this.saving.set(true);
    const current = this.experience();
    this.catalog.update(this.id(), {
      title: this.editTitle.trim(),
      goal: this.editGoal.trim(),
      body: { ...(current?.body ?? {}), requires: parseRequirementLines(this.editRequires) },
    }).subscribe({
      next: (updated) => {
        this.experience.set(updated);
        this.plan.set(null); // stale after a requirements change
        this.saving.set(false);
        this.editing.set(false);
        this.toast.success('Saved', 'Re-resolve the plan to re-check requirements.');
      },
      error: (err) => { this.saving.set(false); this.toast.error('Save failed', message(err)); },
    });
  }

  transition(action: ApprovalAction): void {
    this.transitioning.set(true);
    this.catalog.transition(this.id(), action).subscribe({
      next: (e) => {
        this.transitioning.set(false);
        this.experience.set(e);
        this.toast.success('Approval updated', `Now “${e.approvalState}”.`);
      },
      error: (err) => { this.transitioning.set(false); this.toast.error('Transition blocked', message(err)); },
    });
  }

  runPlan(): void {
    this.planning.set(true);
    this.catalog.plan(this.id()).subscribe({
      next: (p) => {
        this.planning.set(false);
        this.plan.set(p);
        if (p.complete) this.toast.success('Plan resolved', `${p.matched.length} matched · all requirements resolvable.`);
        else this.toast.info('Plan resolved', `${p.unmet.length} unmet requirement${p.unmet.length === 1 ? '' : 's'}.`);
      },
      error: (err) => { this.planning.set(false); this.toast.error('Plan failed', message(err)); },
    });
  }
}

function message(err: unknown): string {
  const e = err as { status?: number; error?: { message?: string; detail?: string } };
  if (e?.status === 0) return 'Cannot reach the catalog server.';
  if (e?.status === 409) return e.error?.message ?? 'Illegal transition for this state.';
  if (e?.status === 401) return 'Unauthorized — reconnect with a valid token.';
  return e?.error?.detail ?? e?.error?.message ?? 'Request failed.';
}
