import { Injectable, signal } from '@angular/core';

/**
 * Records A2UI `ui-action` events dispatched by the reference server so
 * the demo can show them. The protocol switcher wires a custom
 * `UI_ACTION_DISPATCHER` that pushes here — proof that A2UI's
 * distinguishing ui-action path round-trips with the live thread/run
 * ids (the L1 dispatcher fix).
 */
export interface UiActionRecord {
  readonly op: string;
  readonly payload: unknown;
  readonly threadId: string;
  readonly runId: string;
  readonly at: string;
}

@Injectable({ providedIn: 'root' })
export class UiActionLogService {
  private readonly _records = signal<readonly UiActionRecord[]>([]);
  readonly records = this._records.asReadonly();

  record(r: UiActionRecord): void {
    this._records.update((cur) => [...cur, r]);
  }

  clear(): void {
    this._records.set([]);
  }
}
