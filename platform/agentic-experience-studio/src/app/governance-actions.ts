import { HttpErrorResponse } from '@angular/common/http';
import type { WritableSignal } from '@angular/core';
import type { Lifecycle } from './lifecycle';
import type { BarAction } from './lifecycle-bar.component';
import {
  CapabilityCatalogService, ConcurrencyError,
  type ApprovalState, type Capability,
} from './services/capability-catalog.service';
import type { ToastService } from './services/toast.service';

/** Roles allowed to approve/reject (mirrors the catalog `approver-roles` default). */
export const APPROVER_ROLES = ['platform-admin', 'catalog-admin', 'approver'];
export function canApproveWith(roles: readonly string[]): boolean {
  return roles.some((r) => APPROVER_ROLES.includes(r));
}

/** The governance signals a designer keeps in sync with the catalog. */
export interface GovState {
  readonly lifecycle: WritableSignal<Lifecycle>;
  readonly approvalState: WritableSignal<ApprovalState>;
  readonly version: WritableSignal<number>;
}

/** Sync the governance signals from a freshly loaded/updated capability. */
export function applyCapability(g: GovState, c: Capability): void {
  g.lifecycle.set(c.lifecycle as Lifecycle);
  g.approvalState.set(c.approvalState);
  g.version.set(c.version);
}

/** Toast a write failure: concurrency (412), publish/transition gate (409), else generic. */
export function reportWriteError(toast: ToastService, err: unknown, what = 'Save'): void {
  if (err instanceof ConcurrencyError) {
    toast.error('Changed elsewhere', 'This was updated by someone else — reload to see the latest.');
  } else if (err instanceof HttpErrorResponse && (err.status === 409 || err.status === 403)) {
    const msg = (err.error as { message?: string })?.message ?? 'That action is not allowed in the current state.';
    toast.error('Not allowed', msg);
  } else {
    toast.error(`${what} failed`, 'The action could not be completed.');
  }
}

/** Run an approval-bar action (transition vs lifecycle move) + resync signals. */
export function handleBarAction(
  a: BarAction, id: string, g: GovState,
  catalog: CapabilityCatalogService, toast: ToastService,
): void {
  const done = (c: Capability) => applyCapability(g, c);
  if (a.type === 'approval') {
    catalog.transition(id, a.value).subscribe({ next: done, error: (e) => reportWriteError(toast, e, 'Transition') });
  } else {
    catalog.update(id, { lifecycle: a.value }, g.version()).subscribe({ next: done, error: (e) => reportWriteError(toast, e, 'Update') });
  }
}
