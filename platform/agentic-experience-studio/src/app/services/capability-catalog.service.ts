import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

/** A catalog capability (any kind) as returned by `/capabilities`. */
export interface Capability {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: string;
  readonly name: string;
  readonly body: Record<string, unknown>;
  readonly lifecycle: 'draft' | 'published' | 'deprecated' | 'disabled';
  readonly owner: string | null;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly softDeletedAt: string | null;
}

export interface CapabilityListResponse {
  readonly items: readonly Capability[];
  readonly total: number;
}

/**
 * Typed client for the catalog `/capabilities` API — used by the Prompt and
 * Navigation studios (AEP Seam B/E) to author capabilities of a given kind.
 * The runtime registries mirror these kinds; the studio just persists metadata.
 */
@Injectable({ providedIn: 'root' })
export class CapabilityCatalogService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private base(): string {
    const tenant = this.auth.tenant() ?? 'default';
    return `${environment.catalogBaseUrl}/v1/catalogs/${encodeURIComponent(tenant)}/capabilities`;
  }

  listByKind(kind: string): Observable<CapabilityListResponse> {
    const params = new HttpParams().set('kind', kind);
    return this.http.get<CapabilityListResponse>(this.base(), { params });
  }

  create(input: { kind: string; name: string; body: Record<string, unknown>; tags?: string[] }): Observable<Capability> {
    return this.http.post<Capability>(this.base(), input);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base()}/${id}`);
  }
}
