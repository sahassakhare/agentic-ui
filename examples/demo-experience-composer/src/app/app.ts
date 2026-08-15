import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ExperiencePlanner, ExperiencePlanStore,
  ComponentRegistry, FormRegistry, WorkflowRegistry, ExperienceRegistry,
  WidgetContainerComponent, FormRendererComponent, WorkflowRendererComponent,
} from '@infra-tools/agentic-ui';
import { CatalogExperienceSource, CATALOG_TENANT } from './catalog/catalog-experience-source';

const EXAMPLES = [
  'onboard a new employee',
  'file an expense claim',
  'open a support ticket',
];

/**
 * Experience Composer — the end-to-end showcase. A user states a requirement
 * (a goal); the deterministic ExperiencePlanner resolves it against the
 * registries into a governed plan; the generative UI is then assembled and
 * rendered from those registries — with a product-owner-authored workflow
 * driving the end-user UX, step by step.
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, WidgetContainerComponent, FormRendererComponent, WorkflowRendererComponent],
  template: `
    <header class="top">
      <span class="mark"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 12 3 7m9 5 9-5m-9 5v10" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" opacity=".55"/></svg></span>
      <div><strong>Experience Composer</strong><div class="sub">State a requirement → the platform assembles a governed, generative UI from the registries</div></div>
      <span class="pill" [class.err]="catalog.error()">
        @if (catalog.error()) { catalog offline } @else { ● catalog · tenant {{ tenant }} }
      </span>
    </header>

    <div class="grid">
      <!-- LEFT: requirement + registries -->
      <aside>
        <section class="card">
          <div class="eyebrow">1 · Your requirement</div>
          <p class="muted sm">Select from what the platform offers, or describe your own — then compose.</p>

          <label class="lbl" for="exp">Experience</label>
          <select id="exp" class="input" [(ngModel)]="selectedExperience">
            <option value="">— describe a goal below —</option>
            @for (e of experienceOptions(); track e.name) { <option [value]="e.name">{{ e.title }}</option> }
          </select>

          <label class="lbl" for="persona">Persona</label>
          <select id="persona" class="input" [(ngModel)]="persona">
            @for (p of personaOptions(); track p) { <option [value]="p">{{ p }}</option> }
          </select>

          @if (permissionOptions().length) {
            <label class="lbl">Permissions the user holds <span class="muted sm">— defines the access gate</span></label>
            <div class="multibox">
              @for (perm of permissionOptions(); track perm) {
                <label class="chk" [class.on]="hasPermission(perm)">
                  <input type="checkbox" [checked]="hasPermission(perm)" (change)="togglePermission(perm)" /> {{ perm }}
                </label>
              }
            </div>
          }

          <label class="lbl" for="req">Or describe a goal</label>
          <input id="req" class="input" [(ngModel)]="goal" (keyup.enter)="compose()"
                 [disabled]="!!selectedExperience()" placeholder="e.g. onboard a new employee" />
          <div class="ex">
            @for (e of examples; track e) { <button class="chip" (click)="pickGoal(e)">{{ e }}</button> }
          </div>
          <button class="btn primary" (click)="compose()">Compose experience →</button>
        </section>

        <section class="card">
          <div class="eyebrow">The registries</div>
          <p class="muted sm">The generative UI is assembled only from what's registered here — a UI-kit of components, forms, workflows, and business Experiences.</p>
          <div class="reg"><span class="k">Components</span><span class="n">{{ counts().components }}</span></div>
          <div class="names">@for (n of names().components; track n) { <span class="tag">{{ n }}</span> }</div>
          <div class="reg"><span class="k">Forms</span><span class="n">{{ counts().forms }}</span></div>
          <div class="reg"><span class="k">Workflows</span><span class="n">{{ counts().workflows }}</span></div>
          <div class="reg"><span class="k">Experiences <span class="src">· from catalog</span></span><span class="n">{{ counts().experiences }}</span></div>
          <div class="names">@for (n of names().experiences; track n) { <span class="tag brand">{{ n }}</span> }</div>
          <div class="synced">
            @if (catalog.error()) { <span class="warn">⚠ {{ catalog.error() }}</span> }
            @else { <span>Authored in the Studio · synced {{ catalog.lastSync() }}</span> }
            <button class="mini" (click)="refreshFromCatalog()">↻ Refresh</button>
          </div>
        </section>
      </aside>

      <!-- RIGHT: the plan + the generated experience -->
      <main>
        @if (plan(); as p) {
          <section class="card">
            <div class="eyebrow">2 · The plan <span class="muted sm">— resolved deterministically, auditable</span></div>
            <div class="planhead">
              <h2>{{ title() }}</h2>
              @if (p.access?.allowed) { <span class="badge ok">access allowed</span> } @else { <span class="badge bad">denied</span> }
            </div>
            <p class="goalline">Goal: “{{ p.goal }}”</p>
            <div class="stats">
              <div class="stat"><span class="v">{{ p.components.length }}</span><span class="c">components</span></div>
              <div class="stat"><span class="v">{{ p.forms.length }}</span><span class="c">forms</span></div>
              <div class="stat"><span class="v">{{ p.workflow ? 1 : 0 }}</span><span class="c">workflow</span></div>
              <div class="stat" [class.warn]="p.unmet.length"><span class="v">{{ p.unmet.length }}</span><span class="c">unmet</span></div>
            </div>
            <div class="assembled">
              @for (n of p.components; track n) { <span class="tag ok">{{ n }}</span> }
              @for (n of p.forms; track n) { <span class="tag form">form: {{ n }}</span> }
              @if (p.workflow) { <span class="tag flow">workflow: {{ p.workflow }}</span> }
            </div>
          </section>

          @if (p.workflow; as wf) {
            <section class="card exp">
              <div class="eyebrow">3 · The generated experience <span class="muted sm">— product-owner workflow, driving the end-user UX</span></div>
              <div class="stagewrap"><mvk-workflow-renderer [formName]="wf" /></div>
            </section>
          }

          @if (p.forms.length) {
            <section class="card">
              <div class="eyebrow">Catered form <span class="muted sm">— rendered from the FormRegistry (could be a federated MFE)</span></div>
              <div class="stagewrap"><mvk-form-renderer [formName]="p.forms[0]" /></div>
            </section>
          }
        } @else {
          <section class="card empty">
            <div class="mk"><svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M12 3 3 8l9 5 9-5-9-5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m3 13 9 5 9-5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" opacity=".5"/></svg></div>
            <h2>State a requirement to compose an experience</h2>
            <p class="muted">The planner resolves your goal against the registries and assembles the UI — no code, no LLM.</p>
            @if (missed()) { <p class="badge bad">No experience matched “{{ missed() }}”. Try one of the examples.</p> }
          </section>
        }
      </main>
    </div>
  `,
  styleUrl: './app.scss',
})
export class App {
  private readonly planner = inject(ExperiencePlanner);
  private readonly store = inject(ExperiencePlanStore);
  private readonly components = inject(ComponentRegistry);
  private readonly forms = inject(FormRegistry);
  private readonly workflows = inject(WorkflowRegistry);
  private readonly experiences = inject(ExperienceRegistry);
  protected readonly catalog = inject(CatalogExperienceSource);
  protected readonly tenant = CATALOG_TENANT;

  protected readonly examples = EXAMPLES;
  protected readonly goal = signal('');
  protected readonly selectedExperience = signal('');
  protected readonly persona = signal('admin');
  protected readonly selectedPermissions = signal<string[]>([]);
  protected readonly missed = signal<string | null>(null);
  protected readonly plan = computed(() => this.store.plan());

  /** Options discovered from the registered experiences (recompute on re-hydrate). */
  protected readonly experienceOptions = computed(() => {
    this.catalog.count();
    return this.experiences.list().map((e) => ({ name: e.name, title: (e as { title?: string }).title ?? e.name }));
  });
  protected readonly personaOptions = computed(() => {
    this.catalog.count();
    const set = new Set<string>(['admin', 'end-user']);
    for (const e of this.experiences.list()) for (const p of ((e as { personas?: string[] }).personas ?? [])) set.add(p);
    return [...set];
  });
  protected readonly permissionOptions = computed(() => {
    this.catalog.count();
    const set = new Set<string>();
    for (const e of this.experiences.list()) for (const p of ((e as { requiredPermissions?: string[] }).requiredPermissions ?? [])) set.add(p);
    return [...set];
  });

  hasPermission(p: string): boolean { return this.selectedPermissions().includes(p); }
  togglePermission(p: string): void {
    this.selectedPermissions.update((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  }
  pickGoal(g: string): void { this.selectedExperience.set(''); this.goal.set(g); this.compose(); }

  // `catalog.count()` makes these recompute whenever the catalog re-hydrates.
  protected readonly counts = computed(() => {
    this.catalog.count();
    return {
      components: this.components.list().length,
      forms: this.forms.list().filter((f) => !('workflow' in f)).length,
      workflows: this.workflows.list().length,
      experiences: this.experiences.list().length,
    };
  });
  protected readonly names = computed(() => {
    this.catalog.count();
    return {
      components: this.components.list().map((d) => d.name),
      experiences: this.experiences.list().map((d) => (d as { title?: string }).title ?? d.name),
    };
  });

  refreshFromCatalog(): void { void this.catalog.hydrate(); }

  protected readonly title = computed(() => {
    const id = this.plan()?.experienceId;
    const e = this.experiences.list().find((x) => x.name === id) as { title?: string } | undefined;
    return e?.title ?? id ?? 'Experience';
  });

  compose(): void {
    const user = { id: 'demo-user', persona: this.persona(), permissions: this.selectedPermissions() };
    const expId = this.selectedExperience();
    const goal = this.goal().trim();
    // Selecting an Experience plans it directly; otherwise the free-text goal is
    // resolved against the registries (both feed the same deterministic planner).
    const input = expId ? { experienceId: expId, user } : goal ? { goal, user } : null;
    if (!input) return;
    const p = this.planner.plan(input);
    if (!p) { this.missed.set(goal || expId); this.store.clear(); return; }
    this.missed.set(null);
    this.store.set(p);
  }
}
