import { Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';

export type Persona = 'paralegal' | 'associate' | 'lead-counsel' | 'lit-support' | 'vendor-reviewer';

export interface PersonaProfile {
  readonly id: Persona;
  readonly label: string;
  readonly initials: string;
  readonly description: string;
  /** Tools this role MAY invoke. Phase 7 wires this into a `provideToolFilter` decorator. */
  readonly allowedTools: readonly string[];
}

export const PERSONAS: readonly PersonaProfile[] = [
  {
    id: 'lead-counsel',
    label: 'Lead Counsel',
    initials: 'LC',
    description: 'Eleanor Vance — full access',
    allowedTools: ['*'],
  },
  {
    id: 'associate',
    label: 'Associate',
    initials: 'AS',
    description: 'Junior counsel — review + draft productions',
    allowedTools: ['searchDocuments', 'tagDocument', 'markPrivileged', 'addToPrivilegeLog', 'listCustodians', 'acknowledgeLegalHold'],
  },
  {
    id: 'paralegal',
    label: 'Paralegal',
    initials: 'PL',
    description: 'Read + tag; no privilege calls or hold release',
    allowedTools: ['searchDocuments', 'tagDocument', 'listCustodians'],
  },
  {
    id: 'lit-support',
    label: 'Lit-Support',
    initials: 'LS',
    description: 'Custodian onboarding + collection',
    allowedTools: ['addCustodian', 'listCustodians', 'placeLegalHold', 'acknowledgeLegalHold'],
  },
  {
    id: 'vendor-reviewer',
    label: 'Vendor Reviewer',
    initials: 'VR',
    description: 'External — read + tag, scoped to assigned set',
    allowedTools: ['searchDocuments', 'tagDocument'],
  },
];

/**
 * Active persona singleton. Drives the header avatar and Phase 7's
 * permission shim. Persists selection in `sessionStorage` so a refresh
 * doesn't reset the demo to lead counsel mid-walkthrough.
 */
@Injectable({ providedIn: 'root' })
export class PersonaService {
  private readonly key = 'mvk-ediscovery-persona';
  readonly active = signal<Persona>(this.load());

  setActive(p: Persona): void {
    this.active.set(p);
    try { sessionStorage.setItem(this.key, p); } catch { /* private mode */ }
  }

  profile(p: Persona): PersonaProfile {
    return PERSONAS.find((x) => x.id === p) ?? PERSONAS[0]!;
  }

  /** Whether this persona may call the given tool name. */
  canInvoke(p: Persona, toolName: string): boolean {
    const allowed = this.profile(p).allowedTools;
    return allowed.includes('*') || allowed.includes(toolName);
  }

  private load(): Persona {
    try {
      const stored = sessionStorage.getItem(this.key);
      if (stored && PERSONAS.some((p) => p.id === stored)) return stored as Persona;
    } catch { /* private mode */ }
    return environment.persona;
  }
}
