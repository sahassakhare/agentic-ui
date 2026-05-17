import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  ApprovalTransitionError,
  DashboardTemplateRegistry,
  LayoutTemplateRegistry,
  type ApprovalEvent,
  type DashboardTemplate,
  type LayoutTemplate,
} from '@infra-tools/agentic-ui';
import { PersonaService } from '../../services/persona.service';

type AnyTemplate = LayoutTemplate | DashboardTemplate;
type TemplateAction = ApprovalEvent['action'];

interface AnnotatedTemplate {
  readonly kind: 'layout' | 'dashboard';
  readonly entry: AnyTemplate;
}

/**
 * `/admin/templates` — review surface for templates in non-approved
 * states. Lead-counsel + matter-admin personas see this; the demo
 * doesn't gate access (it's a showcase), but production hosts would
 * route-guard.
 *
 * Three sections:
 *  - **In review** — templates submitted for approval. Approve / Reject
 *    actions with a comment.
 *  - **Rejected** — templates the reviewer rejected with comments
 *    visible. Author can resubmit (back to review).
 *  - **Drafts** — author's-private working set. Author can submit
 *    for review.
 *
 * Approved templates aren't shown here — they're in the user-facing
 * picker on /dashboards. Deprecated templates aren't shown either
 * (they live on but are hidden from new use).
 */
@Component({
  selector: 'app-admin-templates',
  standalone: true,
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="page-head">
      <p class="crumb">Admin · Templates</p>
      <h1>Template review queue</h1>
      <p class="muted">
        Templates awaiting matter-lead review, plus rejected drafts pending resubmission.
        Approved templates live in the user-facing picker on
        <a routerLink="/dashboards">/dashboards</a>.
        Acting as <strong>{{ persona.profile(persona.active()).label }}</strong>.
      </p>
    </section>

    <section class="bucket">
      <h2>In review <span class="count">{{ inReview().length }}</span></h2>
      @if (inReview().length === 0) {
        <p class="empty">No templates awaiting review.</p>
      } @else {
        @for (t of inReview(); track t.entry.name) {
          <article class="template-card review">
            <header>
              <div>
                <strong>{{ t.entry.title }}</strong>
                <span class="kind-pill">{{ t.kind }}</span>
                <span class="visibility-pill">{{ t.entry.visibility }}</span>
              </div>
              <span class="version">{{ t.entry.version ?? 'v1' }}</span>
            </header>
            <p class="desc">{{ t.entry.description }}</p>
            <p class="meta">
              author <strong>{{ t.entry.author.userId }}</strong> · submitted
              {{ submittedTimestamp(t.entry) }}
            </p>
            <label class="comment">
              <span>Reviewer comment (optional)</span>
              <textarea rows="2" [(ngModel)]="commentFor[t.entry.name]"
                        placeholder="Why approving / what needs revising"></textarea>
            </label>
            <div class="actions">
              <button type="button" class="btn approve"
                      (click)="transition(t, 'approve')">
                ✓ Approve
              </button>
              <button type="button" class="btn reject"
                      (click)="transition(t, 'reject')">
                ✕ Reject
              </button>
            </div>
            @if (errorFor()[t.entry.name]; as err) {
              <p class="error">{{ err }}</p>
            }
          </article>
        }
      }
    </section>

    <section class="bucket">
      <h2>Rejected <span class="count">{{ rejected().length }}</span></h2>
      @if (rejected().length === 0) {
        <p class="empty">No rejected templates.</p>
      } @else {
        @for (t of rejected(); track t.entry.name) {
          <article class="template-card rejected">
            <header>
              <div>
                <strong>{{ t.entry.title }}</strong>
                <span class="kind-pill">{{ t.kind }}</span>
              </div>
              <span class="version">{{ t.entry.version ?? 'v1' }}</span>
            </header>
            <p class="desc">{{ t.entry.description }}</p>
            @if (lastComment(t.entry); as c) {
              <p class="rejection-comment">
                <strong>Rejection note:</strong> "{{ c }}"
              </p>
            }
            <div class="actions">
              <button type="button" class="btn"
                      (click)="transition(t, 'submit')">
                Resubmit for review
              </button>
            </div>
          </article>
        }
      }
    </section>

    <section class="bucket">
      <h2>Drafts <span class="count">{{ drafts().length }}</span></h2>
      @if (drafts().length === 0) {
        <p class="empty">No private drafts.</p>
      } @else {
        @for (t of drafts(); track t.entry.name) {
          <article class="template-card draft">
            <header>
              <div>
                <strong>{{ t.entry.title }}</strong>
                <span class="kind-pill">{{ t.kind }}</span>
              </div>
              <span class="version">{{ t.entry.version ?? 'v1' }}</span>
            </header>
            <p class="desc">{{ t.entry.description }}</p>
            <p class="meta">author <strong>{{ t.entry.author.userId }}</strong></p>
            <div class="actions">
              <button type="button" class="btn"
                      (click)="transition(t, 'submit')">
                Submit for review
              </button>
            </div>
          </article>
        }
      }
    </section>
  `,
  styles: `
    :host { display: block; max-width: 1100px; }
    .page-head { margin-bottom: var(--s-5); }
    .page-head h1 { margin: 0.2rem 0 0; font-size: var(--fs-2xl); letter-spacing: -0.01em; }
    .crumb { margin: 0; font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-text-faint); }
    .muted { margin: 0.4rem 0 0; color: var(--c-text-2); font-size: var(--fs-sm); max-width: 760px; }
    .bucket { margin-bottom: var(--s-6); }
    .bucket h2 { font-size: var(--fs-lg); margin: 0 0 var(--s-3); display: flex; align-items: center; gap: var(--s-2); }
    .count {
      display: inline-block; padding: 1px 8px; border-radius: var(--r-sm);
      background: var(--c-surface-1); font-family: ui-monospace, monospace; font-size: var(--fs-xs); color: var(--c-text-2);
    }
    .empty { color: var(--c-text-faint); font-style: italic; font-size: var(--fs-sm); }
    .template-card {
      padding: var(--s-3); border: 1px solid var(--c-border); border-radius: var(--r-md);
      background: var(--c-surface); margin-bottom: var(--s-3); display: flex; flex-direction: column; gap: var(--s-2);
    }
    .template-card.review { border-left: 4px solid var(--c-warning, #f59e0b); }
    .template-card.rejected { border-left: 4px solid var(--c-danger, #dc2626); }
    .template-card.draft { border-left: 4px solid var(--c-text-faint); }
    .template-card header { display: flex; justify-content: space-between; align-items: center; }
    .template-card header strong { font-size: var(--fs-md); margin-right: var(--s-2); }
    .kind-pill, .visibility-pill {
      display: inline-block; padding: 1px 7px; margin-right: 4px; border-radius: var(--r-sm);
      background: var(--c-surface-1); border: 1px solid var(--c-border);
      font-family: ui-monospace, monospace; font-size: 0.72rem; color: var(--c-text-2); text-transform: lowercase;
    }
    .version { font-family: ui-monospace, monospace; font-size: var(--fs-xs); color: var(--c-text-faint); }
    .template-card .desc { margin: 0; color: var(--c-text-2); font-size: var(--fs-sm); }
    .template-card .meta { margin: 0; font-size: var(--fs-xs); color: var(--c-text-faint); }
    .rejection-comment {
      margin: 0; padding: var(--s-2); background: var(--c-danger-soft, #fee2e2); border-radius: var(--r-sm);
      font-size: var(--fs-xs); color: var(--c-text-1);
    }
    .comment { display: flex; flex-direction: column; gap: 4px; }
    .comment span { font-size: var(--fs-xs); color: var(--c-text-faint); text-transform: uppercase; letter-spacing: 0.04em; }
    .comment textarea {
      padding: var(--s-2); border: 1px solid var(--c-border); border-radius: var(--r-sm);
      font-family: inherit; font-size: var(--fs-xs); resize: vertical;
    }
    .actions { display: flex; gap: var(--s-2); }
    .btn {
      padding: 0.4rem 0.85rem; font-size: var(--fs-xs); cursor: pointer;
      background: var(--c-surface); border: 1px solid var(--c-border);
      border-radius: var(--r-md); color: var(--c-text-1);
    }
    .btn:hover { background: var(--c-surface-1); border-color: var(--c-accent, #6366f1); }
    .btn.approve { background: var(--c-success, #059669); color: white; border-color: transparent; }
    .btn.approve:hover { filter: brightness(1.08); }
    .btn.reject { background: var(--c-danger, #dc2626); color: white; border-color: transparent; }
    .btn.reject:hover { filter: brightness(1.08); }
    .error { margin: 0; color: var(--c-danger, #dc2626); font-size: var(--fs-xs); }
  `,
})
export class AdminTemplatesPage {
  private readonly layoutRegistry = inject(LayoutTemplateRegistry);
  private readonly dashboardRegistry = inject(DashboardTemplateRegistry);
  protected readonly persona = inject(PersonaService);

  protected readonly commentFor: Record<string, string> = {};
  protected readonly errorFor = signal<Record<string, string>>({});

  protected readonly allTemplates = computed<readonly AnnotatedTemplate[]>(() => [
    ...this.layoutRegistry.entries().map((e) => ({ kind: 'layout' as const, entry: e })),
    ...this.dashboardRegistry.entries().map((e) => ({ kind: 'dashboard' as const, entry: e })),
  ]);

  protected readonly inReview = computed(() => this.allTemplates().filter((t) => t.entry.approvalState === 'review'));
  protected readonly rejected = computed(() => this.allTemplates().filter((t) => t.entry.approvalState === 'rejected'));
  protected readonly drafts = computed(() => this.allTemplates().filter((t) => t.entry.approvalState === 'draft'));

  protected transition(t: AnnotatedTemplate, action: TemplateAction): void {
    const reg = t.kind === 'layout' ? this.layoutRegistry : this.dashboardRegistry;
    const comment = this.commentFor[t.entry.name]?.trim();
    try {
      reg.transition(t.entry.name, action, {
        actor: { userId: this.persona.active(), displayName: this.persona.profile(this.persona.active()).label },
        comment: comment ? comment : undefined,
      });
      // Clear input + any prior error on success.
      this.commentFor[t.entry.name] = '';
      this.errorFor.update((m) => {
        const next = { ...m };
        delete next[t.entry.name];
        return next;
      });
    } catch (err) {
      const msg = err instanceof ApprovalTransitionError
        ? `Illegal transition: ${err.from} → ${err.action}`
        : (err instanceof Error ? err.message : String(err));
      this.errorFor.update((m) => ({ ...m, [t.entry.name]: msg }));
    }
  }

  /** Most recent comment on the template's approval chain (rejected templates). */
  protected lastComment(entry: AnyTemplate): string | null {
    for (let i = entry.approvalChain.length - 1; i >= 0; i--) {
      const c = entry.approvalChain[i].comment;
      if (c) return c;
    }
    return null;
  }

  protected submittedTimestamp(entry: AnyTemplate): string {
    const submit = entry.approvalChain.find((e) => e.action === 'submit');
    return submit?.timestamp ?? '—';
  }
}
