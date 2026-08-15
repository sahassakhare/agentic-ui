/**
 * Host-kit workspace **layouts** — slot maps that compose registered components
 * into a single page. A `kind:'layout'` app surface renders one of these via
 * `<mvk-workspace-layout [slots]>`; each slot's `component` resolves from
 * `ComponentRegistry` (host-kit or, later, a federated MFE) and its `props` are
 * validated + mounted. This is how an application gets a *bespoke composed page*
 * that is neither a wizard journey nor a tile dashboard.
 */
import type { SlotMap } from '@infra-tools/agentic-ui';

/** Named slot maps the SurfaceHost can render by name. */
export const layouts: Record<string, SlotMap> = {
  'ops-cockpit': {
    headcount: {
      component: 'kpi-stat',
      props: { value: { label: 'Active Users', value: 281, delta: 4.2 } },
      size: { default: 'auto' },
    },
    pending: {
      component: 'kpi-stat',
      props: { value: { label: 'Pending Approvals', value: 12, delta: -8 } },
      size: { default: 'auto' },
    },
    byTeam: {
      component: 'bar-chart',
      props: { value: [
        { label: 'Engineering', value: 128 }, { label: 'Sales', value: 74 },
        { label: 'Support', value: 41 }, { label: 'Finance', value: 22 },
      ] },
      size: { default: '2fr' },
    },
  },
};
