import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Custodian } from '@infra-tools/demo-ediscovery-shared';

interface InterviewQuestion {
  readonly id: string;
  readonly text: string;
  readonly priority: 'high' | 'medium' | 'low';
  readonly rationale: string;
}

interface InterviewFinding {
  readonly id: string;
  readonly summary: string;
  readonly evidence: string;
  readonly severity: 'flag' | 'note';
}

/**
 * `<app-interview-prep>` — Workflow F from the post-chat-surfaces
 * design doc. Three phases stacked vertically:
 *
 * 1. Pre-interview: agent-generated question list (seeded for the
 *    demo from the custodian's department + hold status). Production
 *    wires `generateInterviewQuestions` tool.
 * 2. During interview: free-text notes captured in a signal-backed
 *    textarea. Production persists via `PersistenceRegistry`.
 * 3. Post-interview: agent-flagged inconsistencies (seeded). The
 *    cross-reference comes from a `findInconsistencies` tool that
 *    diffs the recorded answers against the documentary record.
 *
 * Domain-specific composition — the lib's seams (Tool / Action /
 * Persistence / chain-hash audit) make this surface cheap to build;
 * we ship one component, no new library code.
 */
@Component({
  selector: 'app-interview-prep',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (custodian(); as c) {
      <section class="prep">
        <header class="phase-head">
          <h4>1. Pre-interview · agent-generated questions</h4>
          <span class="hint">{{ questions().length }} — prioritised against {{ c.name }}'s holdings</span>
        </header>
        <ul class="qlist">
          @for (q of questions(); track q.id) {
            <li class="q" [attr.data-priority]="q.priority">
              <span class="pip">{{ q.priority }}</span>
              <div>
                <strong>{{ q.text }}</strong>
                <span>{{ q.rationale }}</span>
              </div>
            </li>
          }
        </ul>

        <header class="phase-head">
          <h4>2. During interview · session notes</h4>
          <span class="hint">{{ notesLen() }} chars captured</span>
        </header>
        <textarea
          class="notes"
          rows="6"
          placeholder="Capture answers as they come. Auto-saved on blur (demo: in-memory only)."
          [ngModel]="notes()"
          (ngModelChange)="notes.set($event)"
          aria-label="Interview session notes"></textarea>

        <header class="phase-head">
          <h4>3. Post-interview · cross-reference flags</h4>
          <span class="hint">{{ findings().length }} agent-flagged · review before memo</span>
        </header>
        @if (findings().length === 0) {
          <p class="empty">Run the cross-reference tool to flag inconsistencies against the documentary record.</p>
        } @else {
          <ul class="findings">
            @for (f of findings(); track f.id) {
              <li class="finding" [attr.data-severity]="f.severity">
                <strong>{{ f.summary }}</strong>
                <p>{{ f.evidence }}</p>
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
  styles: `
    :host { display: block; }
    .prep { display: flex; flex-direction: column; gap: var(--s-3); }
    .phase-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--s-2); margin-top: var(--s-2); }
    .phase-head h4 { margin: 0; font-size: var(--fs-sm); color: var(--c-text-1); }
    .hint { font-size: var(--fs-xs); color: var(--c-text-faint); }
    .qlist, .findings { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-2); }
    .q, .finding {
      display: flex; gap: var(--s-2); padding: var(--s-2) var(--s-3);
      background: var(--c-surface); border: 1px solid var(--c-border);
      border-left-width: 3px; border-radius: var(--r-md); font-size: var(--fs-sm);
    }
    .q[data-priority="high"]   { border-left-color: #ef4444; }
    .q[data-priority="medium"] { border-left-color: #f59e0b; }
    .q[data-priority="low"]    { border-left-color: #6b7280; }
    .q .pip {
      font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--c-text-faint); align-self: flex-start;
      padding: 0.1rem 0.4rem; border-radius: var(--r-pill); background: var(--c-surface-1);
    }
    .q div, .finding { display: flex; flex-direction: column; gap: 2px; }
    .q strong, .finding strong { color: var(--c-text-1); }
    .q span, .finding p { color: var(--c-text-2); font-size: var(--fs-xs); margin: 0; }
    .finding[data-severity="flag"] { border-left-color: #f59e0b; }
    .finding[data-severity="note"] { border-left-color: #6366f1; }
    .notes {
      width: 100%; box-sizing: border-box;
      padding: var(--s-3); border: 1px solid var(--c-border);
      border-radius: var(--r-md); font-family: inherit;
      font-size: var(--fs-sm); color: var(--c-text-1); background: var(--c-surface);
      resize: vertical; min-height: 100px;
    }
    .notes:focus { outline: 2px solid var(--c-accent, #6366f1); outline-offset: 1px; }
    .empty { margin: 0; font-size: var(--fs-sm); color: var(--c-text-faint); padding: var(--s-2); }
  `,
})
export class InterviewPrepComponent {
  readonly custodian = input.required<Custodian>();

  protected readonly notes = signal('');
  protected readonly notesLen = computed(() => this.notes().length);

  /**
   * Demo: seed the question list deterministically from the
   * custodian's department + hold state. Production: an agent-driven
   * `generateInterviewQuestions(custodianId)` tool returns this same
   * shape, cached + chain-hashed.
   */
  protected readonly questions = computed<readonly InterviewQuestion[]>(() => {
    const c = this.custodian();
    const dept = c.department || 'unknown';
    const base: InterviewQuestion[] = [
      {
        id: 'q-1',
        text: `Walk us through your role on the Acme matter, starting from when you joined ${dept}.`,
        priority: 'high',
        rationale: 'Establish working timeline + reporting chain.',
      },
      {
        id: 'q-2',
        text: 'Describe how you decide what to retain vs delete in routine ops.',
        priority: 'high',
        rationale: 'Retention practices anchor preservation defensibility.',
      },
      {
        id: 'q-3',
        text: 'Any pseudonyms / project code-names you used in correspondence?',
        priority: 'medium',
        rationale: 'Documentary review found references to "Project Phoenix" — confirm scope.',
      },
      {
        id: 'q-4',
        text: 'Do you use any messaging tools outside corporate email (Signal, Slack DMs, personal phone)?',
        priority: 'medium',
        rationale: 'Off-channel collection risk; agent flagged for follow-up.',
      },
    ];
    if (c.hasLegalHold) {
      base.unshift({
        id: 'q-hold',
        text: `You acknowledged a legal hold on ${dept} data. Have you preserved everything since?`,
        priority: 'high',
        rationale: 'Custodian is under active hold — preservation acknowledgement is load-bearing.',
      });
    }
    return base;
  });

  /**
   * Demo: seed a couple of "cross-reference" findings the agent
   * would normally produce post-interview. Production: a
   * `findInconsistencies(custodianId, notes)` tool diffs the
   * recorded answers against the documentary record.
   */
  protected readonly findings = computed<readonly InterviewFinding[]>(() => {
    const c = this.custodian();
    return [
      {
        id: 'f-1',
        severity: 'flag',
        summary: 'Statement about Project Phoenix scope conflicts with email dated 2025-11-12',
        evidence:
          `${c.name} described Phoenix as "exploratory only", but DOC-100482 ` +
          'shows them on a finalised term-sheet review thread.',
      },
      {
        id: 'f-2',
        severity: 'note',
        summary: 'Possible off-channel: Signal mentioned',
        evidence:
          'Custodian acknowledged Signal use. Follow-up subpoena to recover ' +
          'message history if relevant to scope.',
      },
    ];
  });
}
