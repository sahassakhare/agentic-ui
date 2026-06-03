import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { WorkspaceLayoutComponent } from '@infra-tools/agentic-ui';

/**
 * Slot-name → { component, inputs, size } map the lib's
 * `<mvk-workspace-layout>` consumes. Re-declared here as a structural type
 * to avoid a deep import of the lib's internal `SlotMap` type.
 */
export type WorkspaceSlots = Readonly<Record<string, {
  readonly component: string;
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly size?: { readonly default?: string; readonly min?: string; readonly max?: string };
}>>;

/**
 * Adapter widget: the agent's `composeAccountWorkspace` tool emits
 * `components: [{ name: 'workspaceWrapper', props: { slots } }]`. This
 * wrapper takes that `slots` payload and mounts the lib's
 * `<mvk-workspace-layout>` with the agent-emitted slot map.
 */
@Component({
  selector: 'app-workspace-wrapper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WorkspaceLayoutComponent],
  template: `
    <mvk-workspace-layout [slots]="cast(slots())" />
  `,
  styles: `
    :host { display: block; }
    :host ::ng-deep mvk-workspace-layout { min-height: 200px; }
  `,
})
export class WorkspaceWrapperComponent {
  readonly slots = input.required<WorkspaceSlots>();

  // The lib's WorkspaceLayoutComponent input is typed `SlotMap` (a deeper
  // shape). Our `WorkspaceSlots` is structurally compatible — cast so the
  // template binds cleanly without leaking the lib's internal type.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected cast(s: WorkspaceSlots): any { return s; }
}
