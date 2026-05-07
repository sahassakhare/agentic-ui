import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { OperationProgressComponent, OperationRegistry } from '@maverick/agentic-ui';
import { EmptyStateComponent } from '../../ui/empty-state.component';
import { IconComponent } from '../../ui/icon.component';

/**
 * `/operations` page (Capability F5 — r3 plan §9.5.4).
 *
 * Lists all in-flight + recently-completed operations for the current
 * session. Mounts `<mvk-operation-progress>` per row so the same
 * progress affordance appears here as appears inline in the chat panel
 * — one operation, one component, two surfaces.
 *
 * Drives the asynchronous-work scenario AC-F5-3 calls out: paralegal
 * starts a TAR pass at 5pm; navigates away; returns the next morning,
 * opens `/operations`, sees the result. Cross-session durability needs
 * `PersistenceRegistry` binding (deferred follow-up); within-session
 * the registry is in-memory and survives route changes.
 */
@Component({
  selector: 'app-operations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [OperationProgressComponent, EmptyStateComponent, IconComponent],
  template: `
    <section class="page-head">
      <div>
        <p class="crumb">Workload</p>
        <h1>Operations</h1>
        <p class="muted">
          {{ active().length }} active · {{ finished().length }} completed · {{ failed().length }} failed (this session)
        </p>
      </div>
    </section>

    <div class="kpis">
      <div class="kpi" data-tone="warn">
        <span class="lbl">In flight</span>
        <strong>{{ active().length }}</strong>
        <span class="sub">{{ active().length === 0 ? 'idle' : 'streaming progress' }}</span>
      </div>
      <div class="kpi" data-tone="ok">
        <span class="lbl">Completed</span>
        <strong>{{ finished().length }}</strong>
        <span class="sub">terminal-success</span>
      </div>
      <div class="kpi" data-tone="bad">
        <span class="lbl">Failed</span>
        <strong>{{ failed().length }}</strong>
        <span class="sub">terminal-error</span>
      </div>
      <div class="kpi" data-tone="neutral">
        <span class="lbl">Total</span>
        <strong>{{ all().length }}</strong>
        <span class="sub">since last reload</span>
      </div>
    </div>

    <section class="block">
      <header class="block-head">
        <h2>
          <svg-icon name="bolt" [size]="18" />
          Active
        </h2>
        <p class="hint">Long-running operations streaming progress right now.</p>
      </header>
      @if (active().length === 0) {
        <mvk-empty-state
          title="No active operations"
          icon="bolt"
          message="Trigger a long-running tool from the chat (e.g. 'run TAR classification on the un-tagged corpus')."
        />
      } @else {
        <div class="cards">
          @for (op of active(); track op.opId) {
            <mvk-operation-progress [opId]="op.opId" />
          }
        </div>
      }
    </section>

    @if (recentlyDone().length > 0) {
      <section class="block">
        <header class="block-head">
          <h2>
            <svg-icon name="audit" [size]="18" />
            Recently completed
          </h2>
          <p class="hint">Last 20 finished or failed operations.</p>
        </header>
        <div class="cards">
          @for (op of recentlyDone(); track op.opId) {
            <mvk-operation-progress [opId]="op.opId" />
          }
        </div>
      </section>
    }
  `,
  styles: `
    :host { display: block; max-width: 920px; }
    .page-head { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: var(--s-5); gap: var(--s-4); }
    .page-head h1 { margin: 0.2rem 0 0; font-size: var(--fs-2xl); letter-spacing: -0.01em; }
    .crumb { margin: 0; font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-text-faint); }
    .muted { margin: 0.4rem 0 0; color: var(--c-text-2); font-size: var(--fs-sm); }
    .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--s-3); margin-bottom: var(--s-5); }
    .kpi { padding: var(--s-3) var(--s-4); background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--r-md); display: flex; flex-direction: column; gap: 2px; border-left: 4px solid var(--c-border); }
    .kpi[data-tone="warn"] { border-left-color: #f59e0b; }
    .kpi[data-tone="ok"] { border-left-color: #10b981; }
    .kpi[data-tone="bad"] { border-left-color: #ef4444; }
    .kpi[data-tone="neutral"] { border-left-color: #6b7280; }
    .kpi .lbl { font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-text-faint); }
    .kpi strong { font-size: var(--fs-2xl); line-height: 1.1; color: var(--c-text-1); }
    .kpi .sub { font-size: var(--fs-xs); color: var(--c-text-2); }
    .block { margin-bottom: var(--s-5); }
    .block-head { margin-bottom: var(--s-3); }
    .block-head h2 { display: flex; align-items: center; gap: var(--s-2); margin: 0; font-size: var(--fs-lg); }
    .block-head .hint { margin: 0.2rem 0 0; font-size: var(--fs-sm); color: var(--c-text-2); }
    .cards { display: flex; flex-direction: column; gap: var(--s-3); }
  `,
})
export class OperationsComponent {
  private readonly operations = inject(OperationRegistry);

  protected readonly all = this.operations.operations;

  protected readonly active = computed(() =>
    this.all().filter((o) => o.status === 'started' || o.status === 'progress'),
  );

  protected readonly finished = computed(() =>
    this.all().filter((o) => o.status === 'finished'),
  );

  protected readonly failed = computed(() =>
    this.all().filter((o) => o.status === 'failed'),
  );

  /** Newest-first list of finished + failed, capped at 20. */
  protected readonly recentlyDone = computed(() =>
    [...this.all()]
      .filter((o) => o.status === 'finished' || o.status === 'failed')
      .reverse()
      .slice(0, 20),
  );
}
