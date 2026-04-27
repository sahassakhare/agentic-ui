import { Injectable, signal } from '@angular/core';

export interface Profile {
  readonly userId: string;
  readonly fullName: string;
  readonly email: string;
  readonly newsletter: boolean;
}

/**
 * Tiny in-memory user profile, used by the `editProfile` form's `submit`
 * handler so the agent's "save" lands on a real domain service instead
 * of a console.log. Demo-only; no persistence.
 */
@Injectable({ providedIn: 'root' })
export class ProfileService {
  readonly profile = signal<Profile>({
    userId: 'U-1042',
    fullName: 'Sahas Sakhare',
    email: 'sahas@example.com',
    newsletter: true,
  });

  update(patch: Partial<Profile>): Profile {
    const next = { ...this.profile(), ...patch };
    this.profile.set(next);
    return next;
  }
}
