import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DashboardCanvasComponent, type DashboardDef } from '@infra-tools/agentic-ui';

/**
 * Adapter widget: the agent's `composeAccountDashboard` tool emits
 * `components: [{ name: 'dashboardWrapper', props: { dashboard } }]`. This
 * wrapper takes that `dashboard` payload and mounts the lib's
 * `<mvk-dashboard-canvas>` — the same surface a chat shell would use.
 */
@Component({
  selector: 'app-dashboard-wrapper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DashboardCanvasComponent],
  template: `<mvk-dashboard-canvas [dashboard]="dashboard()" />`,
  styles: `:host { display: block; }`,
})
export class DashboardWrapperComponent {
  readonly dashboard = input.required<DashboardDef>();
}
