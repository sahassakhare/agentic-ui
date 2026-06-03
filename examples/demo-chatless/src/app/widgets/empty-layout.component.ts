import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Placeholder layout component the agent-composed dashboard's `LayoutDef`
 * references for its `component` field. `<mvk-dashboard-canvas>` doesn't
 * actually mount this — it does its own grid — but `LayoutDef.component`
 * is a required Type so we provide a tiny no-op.
 */
@Component({
  selector: 'app-empty-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<ng-content />',
})
export class EmptyLayoutComponent {}
