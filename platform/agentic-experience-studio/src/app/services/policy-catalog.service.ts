import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

/** An OPA policy bundle stored in the catalog (ADR-040). */
export interface PolicyBundle {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly regoSource: string;
  readonly description: string | null;
  readonly rulePath: string;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
}

/**
 * Typed client for the catalog `/policy/bundles` API — used by the Policy
 * Studio (AEP Seam E). OPA evaluation stays in the sidecar; the studio only
 * authors the rego bundles (no OPA in the client bundle — runtime non-goal).
 */
@Injectable({ providedIn: 'root' })
export class PolicyCatalogService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private base(): string {
    const tenant = this.auth.tenant() ?? 'default';
    return `${environment.catalogBaseUrl}/v1/catalogs/${encodeURIComponent(tenant)}/policy/bundles`;
  }

  list(): Observable<{ items: readonly PolicyBundle[] }> {
    return this.http.get<{ items: readonly PolicyBundle[] }>(this.base());
  }

  create(input: { name: string; regoSource: string; rulePath?: string; description?: string; isActive?: boolean }): Observable<PolicyBundle> {
    return this.http.post<PolicyBundle>(this.base(), input);
  }

  setActive(id: string, isActive: boolean): Observable<PolicyBundle> {
    return this.http.patch<PolicyBundle>(`${this.base()}/${id}`, { isActive });
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base()}/${id}`);
  }
}
