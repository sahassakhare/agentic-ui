import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  PlaybookRegistry,
  PlaybookRunner,
  PlaybookRunnerComponent,
  type PlaybookDef,
  type PlaybookRun,
  type PlaybookRunnerAction,
  type RunningPlaybook,
} from '@infra-tools/agentic-ui';

/**
 * `/playbooks` route — versioned tool-call sequences
 * (post-chat-surfaces P5).
 *
 * Picks a registered `PlaybookDef`, calls `PlaybookRunner.start(def)`
 * to fire it, and renders the live state via `<mvk-playbook-runner>`.
 * The Approve / Skip / Cancel buttons emit `(action)` which we wire
 * back to the matching `RunningPlaybook` handle method — every step
 * chain-hashes through audit with `origin: 'playbook'`.
 */
@Component({
  selector: 'app-playbooks-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PlaybookRunnerComponent],
  template: `
    <section class="page-head">
      <div>
        <p class="crumb">Workload</p>
        <h1>Playbooks</h1>
        <p class="muted">
          {{ count() }} registered · each run chain-hashes through audit
        </p>
      </div>
    </section>

    @if (count() === 0) {
      <p class="muted">No playbooks registered.</p>
    } @else {
      <div class="layout">
        <aside class="list" aria-label="Registered playbooks">
          <ul>
            @for (item of playbooks(); track item.name) {
              <li>
                <button
                  type="button"
                  class="item"
                  [class.active]="item.name === selectedName()"
                  (click)="select(item)">
                  <strong>{{ item.title }}</strong>
                  <span class="hint">{{ item.steps.length }} steps · {{ item.version ?? 'unversioned' }}</span>
                </button>
              </li>
            }
          </ul>
        </aside>

        <main class="run-pane">
          @if (selected(); as def) {
            <header class="run-head">
              <h2>{{ def.title }}</h2>
              <button class="btn primary" (click)="start(def)" [disabled]="isRunning()">
                {{ isRunning() ? 'Running…' : 'Start run' }}
              </button>
            </header>
            @if (runSnapshot(); as snap) {
              <mvk-playbook-runner [run]="snap" (action)="onAction($event)" />
            } @else {
              <p class="muted">Click <em>Start run</em> to fire the playbook.</p>
            }
          }
        </main>
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .page-head { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: var(--s-5); gap: var(--s-4); }
    .page-head h1 { margin: 0.2rem 0 0; font-size: var(--fs-2xl); letter-spacing: -0.01em; }
    .crumb { margin: 0; font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-text-faint); }
    .muted { margin: 0.4rem 0 0; color: var(--c-text-2); font-size: var(--fs-sm); }
    .layout { display: grid; grid-template-columns: 240px 1fr; gap: var(--s-4); align-items: start; }
    .list ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--s-2); }
    .item {
      display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left;
      padding: var(--s-3); background: var(--c-surface); border: 1px solid var(--c-border);
      border-radius: var(--r-md); cursor: pointer; color: var(--c-text-1);
    }
    .item:hover { background: var(--c-surface-1); }
    .item.active { border-color: var(--c-accent, #6366f1); background: var(--c-surface-1); }
    .item strong { font-size: var(--fs-sm); }
    .item .hint { font-size: var(--fs-xs); color: var(--c-text-2); }
    .run-pane { display: flex; flex-direction: column; gap: var(--s-3); }
    .run-head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); }
    .run-head h2 { margin: 0; font-size: var(--fs-lg); }
    .btn {
      padding: 0.45rem 0.9rem; border: 1px solid var(--c-border); background: var(--c-surface);
      border-radius: var(--r-md); cursor: pointer; font-size: var(--fs-sm); color: var(--c-text-1);
    }
    .btn.primary { background: var(--c-accent, #6366f1); color: white; border-color: transparent; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
  `,
})
export class PlaybooksPage {
  private readonly registry = inject(PlaybookRegistry);
  private readonly runner = inject(PlaybookRunner);

  protected readonly playbooks = this.registry.signal;
  protected readonly count = computed(() => this.playbooks().length);

  protected readonly selectedName = signal<string | null>(this.playbooks()[0]?.name ?? null);
  protected readonly selected = computed(() =>
    this.playbooks().find((p) => p.name === this.selectedName()) ?? this.playbooks()[0] ?? null,
  );

  private handle: RunningPlaybook | null = null;
  protected readonly runSnapshot = signal<PlaybookRun | null>(null);
  protected readonly isRunning = computed(() => {
    const r = this.runSnapshot();
    return r !== null && (r.overall === 'pending' || r.overall === 'running');
  });

  protected select(def: PlaybookDef): void {
    this.selectedName.set(def.name);
    this.runSnapshot.set(null);
    this.handle = null;
  }

  protected start(def: PlaybookDef): void {
    this.handle = this.runner.start(def);
    // The state signal updates as the runner progresses — mirror it
    // into our own writable signal so OnPush picks up changes.
    queueMicrotask(() => this.pump());
  }

  private pump(): void {
    if (!this.handle) return;
    this.runSnapshot.set(this.handle.state());
    void this.handle.done.then((final) => this.runSnapshot.set(final));
    // Re-pump on next animation frame so intermediate states render
    // (PlaybookRunner doesn't currently expose a per-state subscription).
    if (this.runSnapshot()?.overall === 'running') {
      requestAnimationFrame(() => this.pump());
    }
  }

  protected onAction(ev: PlaybookRunnerAction): void {
    if (!this.handle) return;
    switch (ev.action) {
      case 'approve': this.handle.approve(); break;
      case 'skip':    this.handle.skip();    break;
      case 'cancel':  this.handle.cancel();  break;
    }
    this.pump();
  }
}
