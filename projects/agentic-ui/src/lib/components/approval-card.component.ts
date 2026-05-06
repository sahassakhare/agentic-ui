import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  InjectionToken,
  Injector,
  computed,
  inject,
  input,
  signal,
  type Type,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AGENTIC_ACTIVE_PERSONA,
  AGENTIC_TELEMETRY_SINK,
  ApprovalRegistry,
  ComponentRegistry,
  ToolRegistry,
  type Approval,
  type ApprovalDef,
  type ToolContext,
  type ToolDef,
} from '../internal';

interface ResolvedDiffWidget {
  readonly component: Type<unknown>;
  readonly injector: Injector;
}

/**
 * Inline approval card rendered when the chat-shell intercept queues a
 * tool call for HITL (Capability F4 — r3 plan §9.4).
 *
 * Surfaces three things to the active reviewer:
 *
 *   1. The **diff** — a host-supplied widget (`policy.diffRenderer`) that
 *      receives `approvalId` and renders the literal arg payload that
 *      will execute on Approve. NOT an LLM-generated summary; the
 *      reviewer signs off on what runs (per AC-F4-3).
 *   2. The **sign-off prompt** — `policy.signoffMessage(args)` rendered
 *      verbatim above the buttons.
 *   3. **Approve / Reject** controls. Approve runs the gated tool inline
 *      (sidecar execution); Reject captures an optional comment.
 *
 * Persona enforcement: every render checks the active persona against
 * `policy.approverRoles`. A persona not in the role list sees a
 * read-only "you cannot approve this" message — the buttons are
 * absent. The `ApprovalRegistry.transition` call enforces the same
 * invariant at the data layer.
 */
@Component({
  selector: 'mvk-approval-card',
  imports: [FormsModule, NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state(); as s) {
      <article class="card" [class.decided]="s.approval.status !== 'pending'">
        <header>
          <span class="badge" [attr.data-status]="s.approval.status">{{ s.approval.status }}</span>
          <strong>Approval required: {{ s.approval.toolName }}</strong>
        </header>

        @if (s.diffWidget; as d) {
          <div class="diff">
            <ng-container *ngComponentOutlet="d.component; injector: d.injector" />
          </div>
        } @else {
          <pre class="raw">{{ s.argsJson }}</pre>
        }

        <p class="signoff">{{ s.approval.signoffMessage }}</p>

        @if (s.approval.status === 'pending') {
          @if (s.canApprove) {
            <div class="controls">
              <label class="comment">
                Comment (required for Reject)
                <textarea
                  [ngModel]="comment()"
                  (ngModelChange)="comment.set($event)"
                  rows="2"
                  placeholder="Optional for Approve, required for Reject"
                ></textarea>
              </label>
              @if (errorMessage(); as err) {
                <p class="error" role="alert">{{ err }}</p>
              }
              <div class="buttons">
                <button type="button" class="reject" [disabled]="busy()" (click)="reject()">
                  {{ busy() ? '…' : 'Reject' }}
                </button>
                <button type="button" class="approve" [disabled]="busy()" (click)="approve()">
                  {{ busy() ? '…' : 'Approve' }}
                </button>
              </div>
            </div>
          } @else {
            <p class="not-allowed">
              This approval is for
              <strong>{{ s.policy?.approverRoles?.join(' / ') ?? 'a different role' }}</strong>.
              You are signed in as
              <strong>{{ s.activePersona || '(none)' }}</strong>.
            </p>
          }
        } @else {
          <p class="decided-line">
            <strong>{{ s.approval.status === 'approved' ? 'Approved' : 'Rejected' }}</strong>
            by {{ s.approval.approverPersona }} at {{ s.approval.decidedAt }}.
            @if (s.approval.comment) {
              <span class="comment-line">— "{{ s.approval.comment }}"</span>
            }
          </p>
        }
      </article>
    } @else {
      <p class="missing">Approval {{ approvalId() }} not found.</p>
    }
  `,
  styles: `
    :host { display: block; }
    .card { padding: 0.7rem 0.9rem; border: 1px solid #d1d5db; border-radius: 0.5rem; background: #fff; margin-top: 0.5rem; font: 0.88rem system-ui; border-left: 4px solid #d97706; }
    .card.decided { border-left-color: #6b7280; }
    header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
    .badge { font-size: 0.7em; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.04em; background: #fef3c7; color: #92400e; }
    .badge[data-status="approved"] { background: #d1fae5; color: #065f46; }
    .badge[data-status="rejected"] { background: #fee2e2; color: #991b1b; }
    .diff { padding: 0.5rem; background: #f9fafb; border-radius: 0.4rem; margin-bottom: 0.5rem; }
    .raw { padding: 0.5rem 0.7rem; background: #f3f4f6; border-radius: 0.4rem; font-family: ui-monospace, monospace; font-size: 0.78rem; white-space: pre-wrap; margin: 0 0 0.5rem; }
    .signoff { margin: 0 0 0.5rem; font-weight: 500; color: #1f2937; }
    .controls { display: flex; flex-direction: column; gap: 0.4rem; }
    .comment { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.8rem; color: #4b5563; }
    .comment textarea { padding: 0.4rem 0.5rem; border: 1px solid #d1d5db; border-radius: 0.3rem; font: inherit; resize: vertical; }
    .buttons { display: flex; gap: 0.4rem; justify-content: flex-end; }
    button { padding: 0.4rem 0.9rem; border: 0; border-radius: 0.3rem; cursor: pointer; font: inherit; font-weight: 500; }
    button.approve { background: #16a34a; color: #fff; }
    button.reject { background: #dc2626; color: #fff; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .not-allowed { padding: 0.5rem 0.7rem; background: #eff6ff; color: #1e40af; border-radius: 0.4rem; font-size: 0.85rem; }
    .error { padding: 0.4rem 0.6rem; background: #fee2e2; color: #991b1b; border-radius: 0.3rem; font-size: 0.85rem; margin: 0; }
    .decided-line { margin: 0; font-size: 0.85rem; color: #4b5563; }
    .comment-line { color: #6b7280; font-style: italic; }
    .missing { padding: 0.5rem 0.7rem; background: #fef3c7; color: #92400e; border-radius: 0.4rem; font-size: 0.85rem; }
  `,
})
export class ApprovalCardComponent {
  readonly approvalId = input.required<string>();

  private readonly approvals = inject(ApprovalRegistry);
  private readonly tools = inject(ToolRegistry);
  private readonly components = inject(ComponentRegistry);
  private readonly hostInjector = inject(Injector);
  private readonly persona = inject(AGENTIC_ACTIVE_PERSONA);
  private readonly telemetry = inject(AGENTIC_TELEMETRY_SINK);

  protected readonly busy = signal<boolean>(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly comment = signal<string>('');

  // Cache one diff-widget injector per approval id; the diff widget
  // mounts once and stays put across status transitions.
  private readonly diffInjectors = new Map<string, Injector>();

  protected readonly state = computed<{
    approval: Approval;
    policy: ApprovalDef | undefined;
    diffWidget: ResolvedDiffWidget | undefined;
    activePersona: string;
    canApprove: boolean;
    argsJson: string;
  } | null>(() => {
    const id = this.approvalId();
    const records = this.approvals.approvals();
    const approval = records.find((a) => a.id === id);
    if (!approval) return null;
    const policy = this.approvals.get(approval.toolName);
    const activePersona = this.persona() ?? '';
    const canApprove = !!policy && policy.approverRoles.includes(activePersona);
    let diffWidget: ResolvedDiffWidget | undefined;
    if (policy) {
      const def = this.components.get(policy.diffRenderer);
      if (def) {
        diffWidget = {
          component: def.component as Type<unknown>,
          injector: this.diffInjectorFor(approval, def, policy),
        };
      }
    }
    return {
      approval,
      policy,
      diffWidget,
      activePersona,
      canApprove,
      argsJson: stringifyArgs(approval.args),
    };
  });

  protected approve(): void {
    const cur = this.state();
    if (!cur || cur.approval.status !== 'pending') return;
    if (!cur.canApprove) {
      this.errorMessage.set('Active persona is not authorised to approve.');
      return;
    }
    const tool = this.tools.get(cur.approval.toolName);
    if (!tool) {
      this.errorMessage.set(`Tool '${cur.approval.toolName}' is not registered.`);
      return;
    }
    this.errorMessage.set(null);
    this.busy.set(true);
    void this.executeApproval(cur.approval, tool);
  }

  protected reject(): void {
    const cur = this.state();
    if (!cur || cur.approval.status !== 'pending') return;
    if (!cur.canApprove) {
      this.errorMessage.set('Active persona is not authorised to reject.');
      return;
    }
    const note = this.comment().trim();
    if (note.length === 0) {
      this.errorMessage.set('Reject requires a non-empty comment.');
      return;
    }
    this.errorMessage.set(null);
    this.busy.set(true);
    try {
      this.approvals.transition(cur.approval.id, 'rejected', {
        approverPersona: cur.activePersona,
        comment: note,
      });
      this.telemetry.histogram('approval.decision', 1, {
        tool: cur.approval.toolName,
        decision: 'rejected',
      });
    } catch (err) {
      this.errorMessage.set(describe(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async executeApproval(approval: Approval, tool: ToolDef): Promise<void> {
    const cur = this.state();
    if (!cur) return;
    try {
      this.approvals.transition(approval.id, 'approved', {
        approverPersona: cur.activePersona,
        comment: this.comment().trim() || undefined,
      });
      this.telemetry.histogram('approval.decision', 1, {
        tool: approval.toolName,
        decision: 'approved',
      });
      // Sidecar execution — the original chat thread already received
      // the synthetic queued result, so this is fire-and-forget from
      // the chat's perspective. Errors surface inline on the card.
      const handle = approval.continuationHandle;
      const ctx: ToolContext = {
        threadId: handle?.threadId ?? 'approval-card',
        runId: handle?.runId ?? approval.id,
        toolCallId: handle?.toolCallId ?? approval.id,
        signal: new AbortController().signal,
      };
      await tool.handler(approval.args, ctx);
    } catch (err) {
      this.errorMessage.set(describe(err));
    } finally {
      this.busy.set(false);
    }
  }

  private diffInjectorFor(
    approval: Approval,
    componentDef: { component: unknown },
    _policy: ApprovalDef,
  ): Injector {
    let inj = this.diffInjectors.get(approval.id);
    if (!inj) {
      // The diff widget gets the approval id + raw args + sign-off message
      // as Inputs. Hosts can implement a `propsSchema` mirroring this shape;
      // unrecognised inputs are silently ignored by Angular.
      inj = Injector.create({
        providers: [
          // Provide a per-card "approvalId" + "args" + "signoffMessage" as
          // host-readable tokens. Lightweight contract for the diff widget.
          { provide: APPROVAL_DIFF_INPUTS, useValue: {
              approvalId: approval.id,
              args: approval.args,
              signoffMessage: approval.signoffMessage,
            } },
        ],
        parent: this.hostInjector,
      });
      this.diffInjectors.set(approval.id, inj);
    }
    void componentDef;
    return inj;
  }
}

/**
 * Lightweight injection token diff-widget components consume to read the
 * approval's id, args, and sign-off message without needing a public
 * Input contract. Drop-in via `inject(APPROVAL_DIFF_INPUTS, { optional: true })`.
 */
export interface ApprovalDiffInputs {
  readonly approvalId: string;
  readonly args: unknown;
  readonly signoffMessage: string;
}

export const APPROVAL_DIFF_INPUTS = new InjectionToken<ApprovalDiffInputs>(
  'APPROVAL_DIFF_INPUTS',
);

function stringifyArgs(args: unknown): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
