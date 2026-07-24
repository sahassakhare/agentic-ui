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

/**
 * Experience detail (AEP Seam E) — shows one experience, its capability
 * dependency graph (Seam A viz, dependency edges coloured matched/unmet from
 * a server `/plan` dry-run), and the approval-workflow actions.
 */
@Component({
  selector: 'aes-experience-detail',
  imports: [RouterLink, FormsModule, GraphViewComponent],
  template: `
    <a routerLink="/experiences" class="back">← Experiences</a>

    @if (error()) { <p class="error">{{ error() }}</p> }

    @if (experience(); as e) {
      <h1>
        {{ e.title }}
        <span class="badge" [class]="e.approvalState">{{ e.approvalState }}</span>
        <button class="edit" (click)="startEdit(e)">{{ editing() ? 'Cancel' : 'Edit' }}</button>
      </h1>

      @if (editing()) {
        <section class="editform">
          <label>Title <input [(ngModel)]="editTitle" /></label>
          <label>Goal <input [(ngModel)]="editGoal" /></label>
          <label class="wide">Requirements — <code>kind selector [optional]</code>
            <textarea rows="4" [(ngModel)]="editRequires"></textarea>
          </label>
          <button [disabled]="saving()" (click)="save()">{{ saving() ? 'Saving…' : 'Save' }}</button>
        </section>
      } @else {
        <p class="goal">{{ e.goal }}</p>
      }
      <code>{{ e.name }}</code>

      <section class="actions">
        <strong>Approval:</strong>
        @for (a of actions(); track a) {
          <button (click)="transition(a)">{{ a }}</button>
        }
        <button class="plan" (click)="runPlan()">Resolve plan</button>
      </section>

      <section class="graph">
        <h2>Capability dependency graph</h2>
        @if (graph().nodes.length <= 1) {
          <p class="muted">No declared requirements.</p>
        } @else {
          <aes-graph-view [elements]="graphElements()" />
        }
        <ul class="nodes">
          @for (n of graph().nodes; track n.id) {
            <li class="node" [class]="n.state">
              <span class="kind">{{ n.kind }}</span>
              <span class="label">{{ n.label }}</span>
              <span class="state">{{ n.state }}</span>
            </li>
          }
        </ul>
        @if (plan(); as p) {
          <p class="summary" [class.ok]="p.complete">
            {{ p.matched.length }} matched · {{ p.unmet.length }} unmet
            {{ p.complete ? '· ✓ all requirements resolvable' : '' }}
          </p>
        }
      </section>
    }
  `,
  styles: [`
    .back { text-decoration: none; opacity: .7; }
    h1 { display: flex; align-items: center; gap: .75rem; }
    .edit { margin-left: auto; padding: .25rem .7rem; font-size: .8rem; }
    .editform { display: grid; grid-template-columns: 1fr 1fr; gap: .75rem; margin: .5rem 0 1rem;
      padding: .75rem; border: 1px solid color-mix(in srgb, currentColor 15%, transparent); border-radius: 8px; }
    .editform label { display: flex; flex-direction: column; font-size: .75rem; gap: .25rem; }
    .editform .wide { grid-column: 1 / -1; }
    .editform input, .editform textarea { padding: .35rem .5rem; font: inherit; }
    .editform button { grid-column: 1 / -1; justify-self: start; padding: .35rem 1rem; }
    .goal { font-size: 1.05rem; }
    code { opacity: .7; }
    .badge { font-size: .7rem; text-transform: uppercase; padding: .1rem .4rem; border-radius: 4px;
      background: color-mix(in srgb, currentColor 12%, transparent); }
    .badge.approved { background: color-mix(in srgb, green 30%, transparent); }
    .badge.review { background: color-mix(in srgb, orange 30%, transparent); }
    .actions { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; margin: 1rem 0; }
    .actions button { padding: .3rem .7rem; text-transform: capitalize; }
    .actions .plan { margin-left: auto; }
    .nodes { list-style: none; padding: 0; display: flex; flex-direction: column; gap: .35rem; }
    .node { display: flex; gap: .75rem; align-items: center; padding: .4rem .6rem; border-radius: 6px;
      border-left: 3px solid transparent; background: color-mix(in srgb, currentColor 6%, transparent); }
    .node.root { border-left-color: steelblue; font-weight: 600; }
    .node.matched { border-left-color: seagreen; }
    .node.unmet { border-left-color: crimson; }
    .kind { font-size: .7rem; text-transform: uppercase; opacity: .6; min-width: 90px; }
    .state { margin-left: auto; font-size: .7rem; opacity: .6; }
    .summary { opacity: .8; } .summary.ok { color: seagreen; }
    .error { color: crimson; } .muted { opacity: .6; }
  `],
})
export class ExperienceDetailComponent {
  private readonly catalog = inject(ExperienceCatalogService);

  /** Bound from the route param via withComponentInputBinding(). */
  readonly id = input.required<string>();

  readonly experience = signal<Experience | null>(null);
  readonly plan = signal<ExperiencePlanResult | null>(null);
  readonly error = signal<string | null>(null);

  // Edit form state.
  readonly editing = signal(false);
  readonly saving = signal(false);
  editTitle = '';
  editGoal = '';
  editRequires = '';

  /** Raw cytoscape elements for the graph view. */
  readonly graphElements = computed(() => {
    const e = this.experience();
    return e ? buildExperienceGraphElements(e, this.plan() ?? undefined) : [];
  });

  /** Partitioned nodes/edges for the accessible text list. */
  readonly graph = computed(() => partitionGraph(this.graphElements()));

  /** Legal approval actions from the current state (mirrors the server machine). */
  readonly actions = computed<ApprovalAction[]>(() => {
    switch (this.experience()?.approvalState) {
      case 'draft': return ['submit', 'deprecate'];
      case 'review': return ['approve', 'reject', 'deprecate'];
      case 'rejected': return ['submit', 'deprecate'];
      case 'approved': return ['revoke', 'deprecate'];
      default: return [];
    }
  });

  constructor() {
    // Load once the id input is available.
    queueMicrotask(() => this.load());
  }

  private load(): void {
    this.catalog.get(this.id()).subscribe({
      next: (e) => this.experience.set(e),
      error: (err) => this.error.set(message(err)),
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
    this.error.set(null);
    const current = this.experience();
    this.catalog
      .update(this.id(), {
        title: this.editTitle.trim(),
        goal: this.editGoal.trim(),
        body: { ...(current?.body ?? {}), requires: parseRequirementLines(this.editRequires) },
      })
      .subscribe({
        next: (updated) => {
          this.experience.set(updated);
          this.plan.set(null); // stale after a requirements change
          this.saving.set(false);
          this.editing.set(false);
        },
        error: (err) => { this.error.set(message(err)); this.saving.set(false); },
      });
  }

  transition(action: ApprovalAction): void {
    this.error.set(null);
    this.catalog.transition(this.id(), action).subscribe({
      next: (e) => this.experience.set(e),
      error: (err) => this.error.set(message(err)),
    });
  }

  runPlan(): void {
    this.error.set(null);
    this.catalog.plan(this.id()).subscribe({
      next: (p) => this.plan.set(p),
      error: (err) => this.error.set(message(err)),
    });
  }
}

function message(err: unknown): string {
  const e = err as { status?: number; error?: { message?: string } };
  if (e?.status === 409) return e.error?.message ?? 'Illegal transition for this state.';
  if (e?.status === 401) return 'Unauthorized — reconnect with a valid token.';
  return e?.error?.message ?? 'Request failed.';
}
