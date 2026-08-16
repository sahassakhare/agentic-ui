/**
 * Governed capability lifecycle: draft → published → deprecated → disabled
 * (with restore paths). Shared by the generic Capability Studio and the visual
 * designers so lifecycle transitions are authored consistently everywhere.
 */
export type Lifecycle = 'draft' | 'published' | 'deprecated' | 'disabled';

export interface LifecycleTransition { to: Lifecycle; label: string }

/** Valid transitions out of a lifecycle state. */
export function lifecycleTransitions(state: string): readonly LifecycleTransition[] {
  switch (state) {
    case 'draft': return [{ to: 'published', label: 'Publish' }];
    case 'published': return [{ to: 'deprecated', label: 'Deprecate' }, { to: 'disabled', label: 'Disable' }];
    case 'deprecated': return [{ to: 'published', label: 'Restore' }, { to: 'disabled', label: 'Disable' }];
    case 'disabled': return [{ to: 'published', label: 'Restore' }];
    default: return [];
  }
}
