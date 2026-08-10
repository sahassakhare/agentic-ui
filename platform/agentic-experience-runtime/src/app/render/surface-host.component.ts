/**
 * Generalized surface renderer. An application composes *surfaces*, and a surface
 * can be ANY capability the platform can render — this component dispatches a
 * `SurfaceTarget` to the right `@infra-tools/agentic-ui` renderer:
 *
 *   experience / dashboard → planned + access-gated → <app-experience-host>
 *   form                   → <mvk-form-renderer>
 *   workflow               → <mvk-workflow-renderer>
 *   component              → <mvk-widget-container>  (a single component)
 *   layout                 → <mvk-workspace-layout>  (a slot map of components)
 *   mfe                    → a federated remote (loaded at runtime — see note)
 *
 * The leaf components a form/workflow/layout references come from the host kit
 * or, once federation is wired, from an MFE remote — the same registries either way.
 */
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import {
  ExperiencePlanner, ExperienceRegistry,
  FormRendererComponent, WorkflowRendererComponent,
  WidgetContainerComponent, WorkspaceLayoutComponent,
  type ExperienceDef, type AgenticWidgetInstance,
} from '@infra-tools/agentic-ui';
import { ExperienceHostComponent } from './experience-host.component';
import { AuthService } from '../auth/auth.service';
import { layouts } from '../registry/layouts';
import type { SurfaceKind, SurfaceTarget } from '../catalog/application-source';

export type { SurfaceKind, SurfaceTarget };

@Component({
  selector: 'app-surface-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ExperienceHostComponent, FormRendererComponent, WorkflowRendererComponent,
    WidgetContainerComponent, WorkspaceLayoutComponent,
  ],
  template: `
    @if (isExperience()) {
      @if (plan(); as p) { <app-experience-host [experience]="expDef()" [plan]="p" /> }
      @else { <div class="notice bad">Experience "{{ target().name }}" could not be resolved.</div> }
    } @else {
      @switch (target().kind) {
        @case ('form')      { <div class="stagewrap"><mvk-form-renderer [formName]="target().name" /></div> }
        @case ('workflow')  { <div class="stagewrap"><mvk-workflow-renderer [formName]="target().name" /></div> }
        @case ('component') { <div class="stagewrap"><mvk-widget-container [widget]="widgetInstance()" /></div> }
        @case ('layout') {
          @if (slotMap(); as sm) { <mvk-workspace-layout [slots]="sm" /> }
          @else { <div class="notice bad">No layout named "{{ target().name }}" is registered.</div> }
        }
        @case ('mfe') {
          <!-- A federated remote's component, loaded at runtime via Native Federation
               (loadRemoteCapabilities) into ComponentRegistry, then mounted by name. -->
          <div class="stagewrap"><mvk-widget-container [widget]="widgetInstance()" /></div>
        }
        @default { <div class="notice">Unsupported surface kind: {{ target().kind }}</div> }
      }
    }
  `,
  styles: [`
    .stagewrap { display:block; }
    .notice { padding:16px 18px; border-radius:12px; font-size:14px;
      background:rgba(120,120,140,.08); border:1px solid rgba(120,120,140,.16); }
    .notice.bad { background:rgba(192,57,43,.08); border-color:rgba(192,57,43,.3); color:#c0392b; }
    .notice code { font-family:ui-monospace,Menlo,monospace; font-size:12.5px; }
  `],
})
export class SurfaceHostComponent {
  private readonly planner = inject(ExperiencePlanner);
  private readonly auth = inject(AuthService);
  private readonly experiences = inject(ExperienceRegistry);

  readonly target = input.required<SurfaceTarget>();

  protected readonly isExperience = computed(() => {
    const k = this.target().kind;
    return k === 'experience' || k === 'dashboard';
  });

  protected readonly expDef = computed<ExperienceDef | undefined>(() =>
    (this.experiences.list() as ExperienceDef[]).find((e) => e.name === this.target().name));

  protected readonly plan = computed(() => {
    if (!this.isExperience()) return null;
    const user = { id: this.auth.principal()?.id ?? 'end-user', persona: this.auth.persona(), permissions: this.auth.permissions() };
    return this.planner.plan({ experienceId: this.target().name, user });
  });

  protected readonly widgetInstance = computed<AgenticWidgetInstance>(() => ({
    widgetCallId: `surface:${this.target().name}`,
    name: this.target().name,
    props: this.target().props ?? {},
  }));

  protected readonly slotMap = computed(() => layouts[this.target().name]);
}
