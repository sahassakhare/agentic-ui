import { Injectable, computed, signal } from '@angular/core';

export type MatterType = 'Litigation' | 'Investigation' | 'Regulatory' | 'Subpoena';
export type MatterStatus = 'Active' | 'On Hold' | 'Closed';

export interface Matter {
  readonly id: string;
  readonly name: string;
  readonly client: string;
  readonly type: MatterType;
  readonly status: MatterStatus;
  readonly leadAttorney: string;
  readonly custodians: number;
  readonly docs: number;        // documents collected
  readonly reviewed: number;    // documents reviewed
  readonly holds: number;       // active legal holds
  readonly openedAt: string;    // ISO date
  readonly priority: 'High' | 'Medium' | 'Low';
}

/** A production Matter Management app would fetch these from its API; the sample
 *  set makes the remote a complete, self-contained domain artefact. */
const MATTERS: Matter[] = [
  { id: 'M-1042', name: 'Acme v. Globex — Trade Secrets', client: 'Acme Corp', type: 'Litigation', status: 'Active', leadAttorney: 'S. Patel', custodians: 24, docs: 184320, reviewed: 121890, holds: 18, openedAt: '2026-01-14', priority: 'High' },
  { id: 'M-1039', name: 'DOJ Antitrust Inquiry', client: 'Northwind Traders', type: 'Regulatory', status: 'Active', leadAttorney: 'A. Rivera', custodians: 41, docs: 402150, reviewed: 98430, holds: 33, openedAt: '2025-11-02', priority: 'High' },
  { id: 'M-1051', name: 'Internal HR Investigation', client: 'Contoso Ltd', type: 'Investigation', status: 'On Hold', leadAttorney: 'J. Chen', custodians: 7, docs: 21870, reviewed: 21870, holds: 5, openedAt: '2026-02-20', priority: 'Medium' },
  { id: 'M-1055', name: 'Fabrikam Subpoena Response', client: 'Fabrikam Inc', type: 'Subpoena', status: 'Active', leadAttorney: 'M. Okafor', custodians: 12, docs: 56210, reviewed: 40120, holds: 9, openedAt: '2026-03-05', priority: 'Medium' },
  { id: 'M-1028', name: 'Product Liability — Class Action', client: 'Tailspin Toys', type: 'Litigation', status: 'Active', leadAttorney: 'S. Patel', custodians: 63, docs: 731000, reviewed: 512300, holds: 47, openedAt: '2025-08-19', priority: 'High' },
  { id: 'M-0994', name: 'SEC Disclosure Review', client: 'Litware Holdings', type: 'Regulatory', status: 'Closed', leadAttorney: 'A. Rivera', custodians: 15, docs: 88400, reviewed: 88400, holds: 0, openedAt: '2025-04-11', priority: 'Low' },
  { id: 'M-1060', name: 'Whistleblower Complaint', client: 'Adventure Works', type: 'Investigation', status: 'Active', leadAttorney: 'L. Novak', custodians: 9, docs: 34210, reviewed: 12980, holds: 6, openedAt: '2026-04-01', priority: 'High' },
  { id: 'M-1012', name: 'Vendor Contract Dispute', client: 'Proseware Inc', type: 'Litigation', status: 'On Hold', leadAttorney: 'J. Chen', custodians: 11, docs: 47600, reviewed: 30110, holds: 8, openedAt: '2025-09-27', priority: 'Low' },
];

@Injectable({ providedIn: 'root' })
export class MatterService {
  readonly matters = signal<readonly Matter[]>(MATTERS);

  readonly active = computed(() => this.matters().filter((m) => m.status === 'Active'));
  readonly totals = computed(() => {
    const ms = this.matters();
    const docs = ms.reduce((s, m) => s + m.docs, 0);
    const reviewed = ms.reduce((s, m) => s + m.reviewed, 0);
    const holds = ms.reduce((s, m) => s + m.holds, 0);
    return {
      matters: ms.length,
      active: ms.filter((m) => m.status === 'Active').length,
      docs, reviewed, holds,
      reviewPct: docs ? Math.round((reviewed / docs) * 100) : 0,
    };
  });

  reviewPct(m: Matter): number { return m.docs ? Math.round((m.reviewed / m.docs) * 100) : 0; }
}
