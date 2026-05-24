import { Injectable, signal, type Signal } from '@angular/core';

export interface TravelerContext {
  readonly name: string;
  readonly tier: 'silver' | 'gold' | 'platinum';
  readonly homeAirport: string;
}

const DEFAULT: TravelerContext = { name: 'Alex Rivera', tier: 'gold', homeAirport: 'SFO' };

/**
 * Shared-state demo: a small, user-editable traveler profile. Its value is
 * threaded to the agent on every turn via `AGENTIC_RUN_STATE_PROVIDER`
 * (`AgenticRunInput.state`), so the agent can phrase answers for the
 * current context ("As a gold member flying from SFO …"). The editable
 * panel writes here; the run-state provider reads `snapshot()`.
 */
@Injectable({ providedIn: 'root' })
export class TravelerContextService {
  private readonly state = signal<TravelerContext>(DEFAULT);

  /** Reactive view for the editor panel. */
  readonly value: Signal<TravelerContext> = this.state.asReadonly();

  /** Plain snapshot for the run-state provider (sent in `state`). */
  snapshot(): TravelerContext {
    return this.state();
  }

  update(patch: Partial<TravelerContext>): void {
    this.state.update((s) => ({ ...s, ...patch }));
  }
}
