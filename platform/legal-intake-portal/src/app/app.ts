import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { IntakeStore } from './intake.store';
import { MANIFEST } from './manifest';
import { WIDGETS } from './steps';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="shell">
      <header class="mast">
        <div class="crest">A</div>
        <div class="firm"><b>Ashcroft &amp; Vale LLP</b><span>Client &amp; Matter Intake</span></div>
        <div class="sp"></div>
        <div class="ref">Draft ref<b>{{ store.ref }}</b></div>
        <button class="themebtn" (click)="toggleTheme()" title="Toggle theme" aria-label="Toggle light/dark">◑</button>
      </header>

      <h1 class="exp">{{ store.experience.title }}</h1>
      <p class="goal">{{ store.experience.goal }}</p>

      <ol class="stepper">
        @for (id of store.spine; track id; let i = $index) {
          <li [class.done]="store.done() || i < store.spineIndex()" [class.active]="!store.done() && i === store.spineIndex()">
            <span class="bar"></span><span class="lbl">{{ section(id) }}</span>
          </li>
        }
      </ol>

      <section class="card">
        @if (store.done()) {
          <div class="card-bd"><div class="stepwrap done-wrap">
            <div class="seal">⚖</div>
            <h2>Matter opened</h2>
            <div class="matterno">{{ store.matterNo() }}</div>
            <p>{{ clientName() }} · {{ matterType() }} · {{ feeType() }}</p>
            <p>{{ store.data()['conflictFound'] ? 'Conflict waiver recorded — ' : 'Conflicts cleared — ' }}routed to the practice-group partner for acceptance.</p>
          </div></div>
        } @else {
          <div class="card-hd">
            <span class="eyebrow">{{ eyebrow() }}</span>
            <h2>{{ store.step().section }}</h2>
          </div>
          <div class="card-bd">
            <div class="stepwrap">
              <ng-container [ngComponentOutlet]="widget()"></ng-container>
            </div>
          </div>
          <div class="foot">
            <button class="btn ghost" [style.visibility]="store.history().length ? 'visible' : 'hidden'" (click)="store.back()">← Back</button>
            <div class="sp"></div>
            <button class="btn primary" [disabled]="!store.valid()" (click)="store.next()">
              {{ store.isTerminal() ? 'Open matter' : 'Continue →' }}
            </button>
          </div>
        }
      </section>

      <div class="prov">
        Rendered from a <b>published render manifest</b> via <code>&#64;infra-tools/aep-embed-sdk</code> — no agentic-ui.<br>
        The steps and the conflict-check branch come from the manifest; these are this Angular app's own components.
        &nbsp;·&nbsp; <a (click)="peek.set(!peek())">{{ peek() ? 'Hide the manifest ↑' : 'View the manifest driving this →' }}</a>
      </div>
      @if (peek()) { <div class="peek"><pre>{{ manifestJson }}</pre></div> }
    </div>
  `,
})
export class App {
  protected readonly store = inject(IntakeStore);
  protected readonly peek = signal(false);
  protected readonly manifestJson = JSON.stringify(
    { experience: MANIFEST.experience.name, workflow: MANIFEST.workflow, widgets: MANIFEST.widgets.map((w) => w.name) },
    null, 2,
  );

  protected readonly widget = computed(() => WIDGETS[this.store.step().widget] ?? null);
  protected readonly eyebrow = computed(() =>
    this.store.stepId() === 'conflict-review' ? 'Conflict review' : `Step ${this.store.spineIndex() + 1} of ${this.store.spine.length}`);

  protected section(id: string): string {
    return MANIFEST.workflow!.steps.find((s) => s.id === id)?.section ?? id;
  }
  protected clientName(): string { return (this.store.data()['client'] as { name?: string } | undefined)?.name || 'The client'; }
  protected matterType(): string { return (this.store.data()['matter'] as { type?: string } | undefined)?.type || 'Matter'; }
  protected feeType(): string { return (this.store.data()['fees'] as { type?: string } | undefined)?.type || 'fees TBD'; }

  protected toggleTheme(): void {
    const root = document.documentElement;
    const cur = root.getAttribute('data-theme')
      ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    root.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
  }
}
