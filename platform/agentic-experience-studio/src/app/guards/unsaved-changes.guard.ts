import { inject } from '@angular/core';
import type { CanDeactivateFn } from '@angular/router';
import { ConfirmService } from '../services/confirm.service';

/** Implemented by a designer that tracks unsaved edits. */
export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

/**
 * Route guard: prompt before leaving a designer with unsaved edits. Applied to
 * the per-capability design routes. Uses the themed confirm dialog; the designer
 * decides "dirty" by comparing its editable state to the loaded snapshot.
 */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  if (component?.hasUnsavedChanges?.()) {
    return inject(ConfirmService).ask({
      title: 'Discard unsaved changes?',
      message: 'You have unsaved changes in this designer. Leaving will discard them.',
      confirmLabel: 'Discard & leave',
      danger: true,
    });
  }
  return true;
};
