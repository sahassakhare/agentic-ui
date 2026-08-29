/**
 * Generalized surface renderer. An application composes *surfaces*, and a surface
 * can be ANY capability the platform can render — this dispatches a `SurfaceTarget`
 * to the right `@infra-tools/agentic-ui` renderer:
 *
 *   experience / dashboard → planned + access-gated → <catalog-experience-host>
 *   form                   → <mvk-form-renderer>
 *   workflow               → <mvk-workflow-renderer>
 *   component / mfe         → <mvk-widget-container>
 *   layout                 → <mvk-workspace-layout>  (a slot map of components)
 */
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import {
  ExperiencePlanner, ExperienceRegistry, LayoutRegistry,
  FormRendererComponent, WorkflowRendererComponent,
  WidgetContainerComponent, WorkspaceLayoutComponent,
  type ExperienceDef, type AgenticWidgetInstance, type SlotMap,
} from '@infra-tools/agentic-ui';
import { CatalogExperienceHostComponent } from './experience-host.component';
import { CATALOG_AUTH } from '../catalog-config';
import type { SurfaceKind, SurfaceTarget } from '../application-source';

export type { SurfaceKind, SurfaceTarget };

@Component({
  selector: 'catalog-surface-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CatalogExperienceHostComponent, FormRendererComponent, WorkflowRendererComponent,
    WidgetContainerComponent, WorkspaceLayoutComponent,
  ],
  template: `
    @if (isExperience()) {
      @if (plan(); as p) { <catalog-experience-host [experience]="expDef()" [plan]="p" /> }
      @else { <div class="notice bad">Experience "{{ target().name }}" could not be resolved.</div> }
    } @else {
      @switch (target().kind) {
        @case ('form')      { <div class="stagewrap"><mvk-form-renderer [formName]="target().name" [initialValues]="formInitialValues()" [context]="formContext()" /></div> }
        @case ('workflow')  { <div class="stagewrap"><mvk-workflow-renderer [formName]="target().name" /></div> }
        @case ('component') { <div class="stagewrap"><mvk-widget-container [widget]="widgetInstance()" /></div> }
        @case ('layout') {
          @if (slotMap(); as sm) { <mvk-workspace-layout [slots]="sm" /> }
          @else { <div class="notice bad">No layout named "{{ target().name }}" is registered.</div> }
        }
        @case ('mfe') { <div class="stagewrap"><mvk-widget-container [widget]="widgetInstance()" /></div> }
        @default { <div class="notice">Unsupported surface kind: {{ target().kind }}</div> }
      }
    }
  `,
  styles: [`
    .stagewrap { display:block; }
    .notice { padding:16px 18px; border-radius:12px; font-size:14px;
      background:rgba(120,120,140,.08); border:1px solid rgba(120,120,140,.16); }
    .notice.bad { background:rgba(192,57,43,.08); border-color:rgba(192,57,43,.3); color:#c0392b; }
  `],
})
export class CatalogSurfaceHostComponent {
  private readonly planner = inject(ExperiencePlanner);
  private readonly auth = inject(CATALOG_AUTH);
  private readonly experiences = inject(ExperienceRegistry);
  private readonly layouts = inject(LayoutRegistry);

  readonly target = input.required<SurfaceTarget>();

  protected readonly isExperience = computed(() => {
    const k = this.target().kind;
    return k === 'experience' || k === 'dashboard';
  });

  protected readonly expDef = computed<ExperienceDef | undefined>(() =>
    (this.experiences.list() as ExperienceDef[]).find((e) => e.name === this.target().name));

  protected readonly plan = computed(() => {
    if (!this.isExperience()) return null;
    const user = {
      id: this.auth.principalId?.() ?? 'end-user',
      persona: this.auth.persona?.() ?? 'end-user',
      permissions: this.auth.permissions?.() ?? [],
    };
    return this.planner.plan({ experienceId: this.target().name, user });
  });

  protected readonly widgetInstance = computed<AgenticWidgetInstance>(() => ({
    widgetCallId: `surface:${this.target().name}`,
    name: this.target().name,
    props: this.target().props ?? {},
  }));

  /** Resolve a layout slot map from the LayoutRegistry, or an authored `props.slots`. */
  protected readonly slotMap = computed<SlotMap | undefined>(() => {
    const def = this.layouts.get(this.target().name) as { slots?: SlotMap } | undefined;
    return def?.slots ?? (this.target().props?.['slots'] as SlotMap | undefined);
  });

  protected readonly formInitialValues = computed(() => asRecord(this.target().props?.['initialValues']));
  protected readonly formContext = computed(() => asRecord(this.target().props?.['context']));
}

/** Narrow an authored prop value to a plain record (else empty). */
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
