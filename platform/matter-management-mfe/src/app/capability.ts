import { defineCapabilityModule, agenticWidget } from '@infra-tools/agentic-ui';
import { z } from 'zod';
import { MatterDashboardComponent } from './matter-dashboard.component';
import { MatterListComponent } from './matter-list.component';
import { MatterReportComponent } from './matter-report.component';

const anyProps = z.object({}).passthrough();

/**
 * The Matter Management remote's capability module — what the platform loads via
 * Native Federation. It contributes three governed component surfaces
 * (matter-dashboard, matter-list, matter-report) that the Studio composes into
 * pages/dashboards and the Hub renders, exactly like host-kit components.
 */
export const capability = defineCapabilityModule({
  remoteName: 'matter-management',
  version: '1.0.0',
  tools: [],
  components: [
    agenticWidget({ name: 'matter-dashboard', component: MatterDashboardComponent, propsSchema: anyProps }),
    agenticWidget({ name: 'matter-list', component: MatterListComponent, propsSchema: anyProps }),
    agenticWidget({ name: 'matter-report', component: MatterReportComponent, propsSchema: anyProps }),
  ],
});
