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

/**
 * Allow-lists are the demo's permission contract. Each persona names
 * the tools it MAY invoke; the host's `installPersonaScopePolicy`
 * (in `app.config.ts`) wires this into `ToolRegistry.setScopePolicy`
 * so every read — chat shell, sidebar tool counter, chat-rail
 * capability badge — sees the same filtered view.
 *
 * @remarks
 * The library's `RegistryEntry.scopes` field can carry these names
 * on each tool literal too. We keep the host-side allow-list because
 * the role taxonomy is firm-specific — federated remotes don't know
 * the names. The scope policy reads `entry.name` against this map.
 *
 * Tool naming convention: every tool name is a stable identifier so
 * an allow-list survives the addition of new specialists / remotes.
 */
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
    description: 'Review + draft productions; no hold lifecycle, no delivery',
    allowedTools: [
      // Read / search
      'searchDocuments', 'listCustodians',
      'semanticSearch', 'filterByDateRange', 'filterByCustodians', 'runTARClassifier',
      // Review
      'tagDocument', 'markPrivileged', 'addToPrivilegeLog',
      // Hold acknowledgement (not issue / release)
      'acknowledgeLegalHold',
      // Draft productions (no exportProductionSet — that's lead counsel only)
      'createProductionSet', 'assignBatesNumbers', 'redactDocument',
      'generateChainOfCustodyReport',
      // Custodian intake — associate can prep an intake form for
      // supervisor sign-off (F1 supervisor section fires on
      // persona !== 'lead-counsel').
      'openCustodianIntake', 'generateCustodianIntakeForm',
    ],
  },
  {
    id: 'paralegal',
    label: 'Paralegal',
    initials: 'PL',
    description: 'Intake prep + read + tag + TAR; no privilege rulings, no hold ops, no productions',
    allowedTools: [
      'searchDocuments', 'listCustodians',
      'semanticSearch', 'filterByDateRange', 'filterByCustodians', 'runTARClassifier',
      'tagDocument',
      // Privilege-log SNAPSHOT — paralegals can record but not RULE on privilege
      'addToPrivilegeLog',
      // Custodian intake — paralegal preps the intake form (F1
      // supervisor sign-off section appears because persona !==
      // 'lead-counsel'). The actual addCustodian remains gated.
      'openCustodianIntake', 'generateCustodianIntakeForm',
    ],
  },
  {
    id: 'lit-support',
    label: 'Lit-Support',
    initials: 'LS',
    description: 'Custodian onboarding + collection + hold lifecycle',
    allowedTools: [
      'addCustodian', 'listCustodians',
      'placeLegalHold', 'acknowledgeLegalHold',
      // Limited search — useful for verifying collections completed
      'filterByCustodians', 'filterByDateRange',
      // F1 intake forms — both predefined and agent-generated
      'openCustodianIntake', 'generateCustodianIntakeForm',
    ],
  },
  {
    id: 'vendor-reviewer',
    label: 'Vendor Reviewer',
    initials: 'VR',
    description: 'External — read + tag only; cannot mark privileged or run TAR',
    allowedTools: [
      'searchDocuments',
      'filterByDateRange', 'filterByCustodians',
      'tagDocument',
    ],
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
