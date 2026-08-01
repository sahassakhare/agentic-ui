import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import {
  ExperienceCatalogService,
  type ApprovalAction,
  type CapabilityRequirement,
  type Experience,
  type ExperiencePlanResult,
} from '../services/experience-catalog.service';
import { buildExperienceGraphElements, partitionGraph } from '../experience-graph';
import { GraphViewComponent } from '../graph-view.component';
import { ToastService } from '../services/toast.service';
import { CapabilityCatalogService } from '../services/capability-catalog.service';
import { JourneyFlowComponent, type JourneyFlowStep } from '../journey-flow.component';
import { RequirementsBuilderComponent } from '../requirements-builder.component';

/**
 * Experience detail (AEP Seam E) — one experience, its capability dependency
 * graph (Seam A viz, edges coloured matched/unmet from a server `/plan`
 * dry-run), and the approval-workflow actions. Product-quality: skeleton load,
 * a graph legend, a plan stat strip, and toast feedback for every mutation.
 */
@Component({
  selector: 'aes-experience-detail',
  imports: [RouterLink, FormsModule, GraphViewComponent, JourneyFlowComponent, RequirementsBuilderComponent],
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
              <div class="field" style="grid-column:1 / -1"><label class="label">Requirements <span class="help">— pick a kind, then a registry entry of that kind</span></label>
                <aes-requirements-builder [initial]="editInitial()" (requirementsChange)="editRequires = $event" /></div>
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

        <!-- Composition & health -->
        <section class="card" style="margin-top:var(--s5); overflow:hidden">
          <div class="card-pad comp-head">
            <div class="stack" style="gap:2px">
              <h2 style="font-size:var(--fs-lg)">Composition &amp; health</h2>
              <span class="muted" style="font-size:var(--fs-sm)">What this experience is <em>made of</em> and whether it resolves — the parts list, not the journey.</span>
            </div>
            @if (health(); as h) {
              <span class="health-pill" [class.ok]="h.complete" [class.warn]="!h.complete">
                <i class="hdot"></i>{{ h.complete ? 'Resolvable' : h.unmet + ' unmet' }}
              </span>
            } @else {
              <button class="btn btn-primary btn-sm" type="button" (click)="runPlan()" [disabled]="planning()">
                @if (planning()) { <span class="spinner" aria-hidden="true"></span> Resolving… } @else { Resolve plan }
              </button>
            }
          </div>

          @if (health(); as h) {
            <div class="card-pad health">
              <div class="cov">
                <div class="cov-row"><span>Requirement coverage</span><span class="mono">{{ h.matched }}/{{ h.total }} met</span></div>
                <div class="cov-bar"><span [class.full]="h.complete" [style.width.%]="h.pct"></span></div>
              </div>
              <div class="hstats">
                <div class="hstat ok"><span class="v">{{ h.matched }}</span><span class="k">matched</span></div>
                <div class="hstat" [class.bad]="h.unmet"><span class="v">{{ h.unmet }}</span><span class="k">unmet</span></div>
                <div class="hstat"><span class="v">{{ h.total }}</span><span class="k">required</span></div>
              </div>
            </div>
          }

          @if (graph().nodes.length <= 1) {
            <div class="empty" style="margin:0 var(--s5) var(--s5); border:0; padding:var(--s6)">
              <p>No declared requirements yet. <button class="btn btn-ghost btn-sm" (click)="startEdit(e)">Add some</button></p>
            </div>
          } @else {
            <div style="padding:0 var(--s5)"><aes-graph-view [elements]="graphElements()" /></div>
            <div class="legend card-pad" style="padding-block:var(--s3)">
              <span><i class="dot root"></i>goal</span>
              <span><i class="dot matched"></i>matched</span>
              <span><i class="dot unmet"></i>unmet</span>
              <span><i class="dot optional"></i>optional</span>
            </div>
            <ul class="nodes">
              @for (n of parts(); track n.id) {
                <li class="node" [class]="n.optional && n.state === 'unmet' ? 'optional' : n.state">
                  <span class="badge plain"
                        [class.badge-info]="n.state === 'root'"
                        [class.badge-ok]="n.state === 'matched'"
                        [class.badge-danger]="n.state === 'unmet' && !n.optional"
                        [class.badge-warn]="n.state === 'unmet' && n.optional">{{ n.kind }}</span>
                  <span class="nlabel">{{ n.label }}</span>
                  @if (n.state === 'unmet' && !n.optional) { <span class="hint">not found in the catalog</span> }
                  @else if (n.state === 'unmet' && n.optional) { <span class="hint muted-hint">optional · not present</span> }
                  <span class="nstate spacer">{{ n.optional && n.state === 'unmet' ? 'optional' : n.state }}</span>
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
    .comp-head { padding-bottom: var(--s3); display: flex; align-items: center; justify-content: space-between; gap: var(--s3); flex-wrap: wrap; }
    .health-pill { display: inline-flex; align-items: center; gap: var(--s2); font-size: var(--fs-sm); font-weight: 600;
      padding: 4px 12px; border-radius: var(--r-full); border: 1px solid var(--border); }
    .health-pill .hdot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-faint); }
    .health-pill.ok { color: var(--ok); background: var(--ok-soft); border-color: var(--ok-border); }
    .health-pill.ok .hdot { background: var(--ok); }
    .health-pill.warn { color: var(--warn); background: var(--warn-soft); border-color: var(--warn-border); }
    .health-pill.warn .hdot { background: var(--warn); }
    .health { display: grid; grid-template-columns: 1fr auto; gap: var(--s5); align-items: center; padding-top: 0;
      padding-bottom: var(--s4); border-bottom: 1px solid var(--border); }
    .cov { min-width: 0; }
    .cov-row { display: flex; justify-content: space-between; font-size: var(--fs-sm); color: var(--text-muted); margin-bottom: 6px; }
    .cov-row .mono { font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text); }
    .cov-bar { height: 8px; border-radius: var(--r-full); background: var(--surface-2); overflow: hidden; }
    .cov-bar span { display: block; height: 100%; background: var(--warn); border-radius: var(--r-full); transition: width .3s ease; }
    .cov-bar span.full { background: var(--ok); }
    .hstats { display: flex; gap: var(--s4); }
    .hstat { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 52px; }
    .hstat .v { font-size: var(--fs-lg); font-weight: 650; font-variant-numeric: tabular-nums; line-height: 1; }
    .hstat .k { font-size: var(--fs-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: .06em; font-family: var(--font-mono); }
    .hstat.ok .v { color: var(--ok); }
    .hstat.bad .v { color: var(--danger); }
    .legend { display: flex; gap: var(--s4); font-size: var(--fs-xs); color: var(--text-muted); }
    .legend span { display: inline-flex; align-items: center; gap: var(--s1); }
    .legend .dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
    .dot.root { background: var(--info); } .dot.matched { background: var(--ok); } .dot.unmet { background: var(--danger); } .dot.optional { background: var(--warn); }
    .nodes { list-style: none; margin: 0; padding: var(--s3) var(--s5) var(--s5); display: flex; flex-direction: column; gap: var(--s2); }
    .node { display: flex; align-items: center; gap: var(--s3); padding: var(--s3); border-radius: var(--r-sm);
      border: 1px solid var(--border); background: var(--surface); border-left: 3px solid var(--border-strong); }
    .node.root { border-left-color: var(--info); }
    .node.matched { border-left-color: var(--ok); }
    .node.unmet { border-left-color: var(--danger); background: var(--danger-soft); }
    .node.optional { border-left-color: var(--warn); }
    .nlabel { font-weight: 550; }
    .hint { font-size: var(--fs-xs); color: var(--danger); font-family: var(--font-mono); }
    .hint.muted-hint { color: var(--text-muted); }
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
  editTitle = ''; editGoal = '';
  /** Requirements from the shared builder + the value it was seeded with. */
  editRequires: CapabilityRequirement[] = [];
  readonly editInitial = signal<readonly CapabilityRequirement[]>([]);

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

  /** Requirement-coverage health, derived from the server `/plan` resolution. */
  readonly health = computed(() => {
    const p = this.plan();
    if (!p) return null;
    const total = p.matched.length + p.unmet.length;
    const pct = total ? Math.round((p.matched.length / total) * 100) : 100;
    return { total, matched: p.matched.length, unmet: p.unmet.length, pct, complete: p.complete };
  });

  /** Node ids that correspond to an OPTIONAL requirement (unmet ≠ blocking). */
  private readonly optionalIds = computed(() => {
    const set = new Set<string>();
    for (const r of this.experience()?.body.requires ?? []) {
      if (r.optional) set.add(`${r.kind}:${r.name ?? (r.tag ? `#${r.tag}` : '*')}`);
    }
    return set;
  });

  /** Parts list: root first, then blocking-unmet, optional-unmet, matched. */
  readonly parts = computed(() => {
    const opt = this.optionalIds();
    const rank = (n: { state: string; optional: boolean }) =>
      n.state === 'root' ? 0 : n.state === 'unmet' && !n.optional ? 1 : n.state === 'unmet' ? 2 : 3;
    return this.graph().nodes
      .map((n) => ({ ...n, optional: opt.has(n.id) }))
      .sort((a, b) => rank(a) - rank(b));
  });

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
      next: (e) => { this.experience.set(e); this.loading.set(false); this.loadJourney(e); this.autoResolve(e); },
      error: (err) => { this.error.set(message(err)); this.loading.set(false); },
    });
  }

  /** Silently resolve the plan on load so Composition & health is accurate
   *  immediately (no all-unmet default). The action-bar button re-runs it with
   *  toast feedback. Skipped when there's nothing to resolve. */
  private autoResolve(e: Experience): void {
    if (!(e.body.requires ?? []).length) return;
    this.catalog.plan(this.id()).subscribe({ next: (p) => this.plan.set(p), error: () => { /* keep manual button */ } });
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
    const requires = [...(e.body.requires ?? [])];
    this.editRequires = requires;          // unchanged unless the builder emits
    this.editInitial.set(requires);        // seeds the builder rows
    this.editing.set(true);
  }

  save(): void {
    this.saving.set(true);
    const current = this.experience();
    this.catalog.update(this.id(), {
      title: this.editTitle.trim(),
      goal: this.editGoal.trim(),
      body: { ...(current?.body ?? {}), requires: this.editRequires },
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
