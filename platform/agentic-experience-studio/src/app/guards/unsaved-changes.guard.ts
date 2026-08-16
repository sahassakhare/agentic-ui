import type { CanDeactivateFn } from '@angular/router';

/** Implemented by a designer that tracks unsaved edits. */
export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

/**
 * Route guard: prompt before leaving a designer with unsaved edits. Applied to
 * the per-capability design routes. Uses a native confirm — simple + reliable;
 * the designer decides "dirty" by comparing its editable state to the loaded
 * snapshot.
 */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  if (component?.hasUnsavedChanges?.()) {
    return confirm('You have unsaved changes. Leave this designer and discard them?');
  }
  return true;
};
