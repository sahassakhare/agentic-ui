/**
 * Renders a resolved experience as the actual end-user application — a
 * dashboard, a guided workflow journey, or a plain form — by switching the
 * library renderers on the resolved {@link RenderMode}. Both paths reuse
 * `@infra-tools/agentic-ui` renderers unchanged; this component is the only
 * new wiring that unifies dashboards and journeys under one host.
 */
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import {
  DashboardRegistry,
  DashboardCanvasComponent, WorkflowRendererComponent, FormRendererComponent,
  type ExperienceDef, type ExperiencePlan,
} from '@infra-tools/agentic-ui';
import { resolveRenderMode, type RenderMode } from './experience-render-mode';

@Component({
  selector: 'app-experience-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DashboardCanvasComponent, WorkflowRendererComponent, FormRendererComponent],
  template: `
    @switch (mode().kind) {
      @case ('dashboard') {
        <mvk-dashboard-canvas [dashboard]="asDashboard(mode()).dashboard" (explain)="onExplain($event)" />
      }
      @case ('workflow') {
        <div class="stagewrap"><mvk-workflow-renderer [formName]="asNamed(mode()).formName" /></div>
      }
      @case ('form') {
        <div class="stagewrap"><mvk-form-renderer [formName]="asNamed(mode()).formName" /></div>
      }
      @case ('denied') {
        <div class="notice bad">Access denied — {{ asDenied(mode()).reason }}</div>
      }
      @default {
        <div class="notice">This experience has nothing to render yet.</div>
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
export class ExperienceHostComponent {
  private readonly dashboards = inject(DashboardRegistry);

  readonly experience = input<ExperienceDef | undefined>();
  readonly plan = input.required<ExperiencePlan>();

  protected readonly mode = computed<RenderMode>(() =>
    resolveRenderMode(this.experience(), this.plan(), this.dashboards),
  );

  // Narrowing helpers for the template (strictTemplates-friendly).
  protected asDashboard(m: RenderMode) { return m as Extract<RenderMode, { kind: 'dashboard' }>; }
  protected asNamed(m: RenderMode) { return m as Extract<RenderMode, { kind: 'workflow' | 'form' }>; }
  protected asDenied(m: RenderMode) { return m as Extract<RenderMode, { kind: 'denied' }>; }

  protected onExplain(_e: unknown): void { /* hook: wire to an assistant/telemetry later */ }
}
