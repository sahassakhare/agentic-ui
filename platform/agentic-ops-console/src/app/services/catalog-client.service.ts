import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

/**
 * Wire-format types — kept loose because the catalog server is the
 * source of truth and any drift here is a bug there. Strict Zod
 * validation can be layered on later (C6.1) if the console grows
 * beyond viewing.
 */
export interface Capability {
  readonly id: string;
  readonly tenantId: string;
  readonly kind: string;
  readonly name: string;
  readonly body: Record<string, unknown>;
  readonly lifecycle: 'draft' | 'published' | 'deprecated' | 'disabled';
  readonly owner: string | null;
  readonly tags: readonly string[];
  readonly requiredHostVersion: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
  readonly softDeletedAt: string | null;
}

export interface CapabilityListResponse {
  readonly items: readonly Capability[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface MfeRemote {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly manifestUrl: string;
  readonly version: string | null;
  readonly requiredHostVersion: string | null;
  readonly exposes: Record<string, readonly string[]>;
  readonly status: 'active' | 'inactive' | 'degraded';
  readonly lastHealthAt: string | null;
}

export interface RoleMapping {
  readonly id: string;
  readonly tenantId: string;
  readonly claimPath: string;
  readonly claimValue: string;
  readonly runtimePersona: string;
  readonly priority: number;
  readonly enabled: boolean;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
}

export interface AuditVerifyResult {
  readonly valid: boolean;
  readonly checkedRows: number;
  readonly chainHead: { chainPosition: number; entryHash: string } | null;
  readonly brokenAt: { chainPosition: number; reason: string } | null;
}

export interface UsageAggregate {
  readonly from: string | null;
  readonly to: string | null;
  readonly byKind: Record<string, number>;
  readonly totalEvents: number;
  readonly totalQuantity: number;
}

export interface UsageEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly occurredAt: string;
  readonly kind: string;
  readonly quantity: number;
  readonly tags: Record<string, unknown>;
  readonly idempotencyKey: string | null;
}

export interface Tenant {
  readonly id: string;
  readonly displayName: string;
  readonly status: 'active' | 'suspended' | 'deleted';
  readonly quotas: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly onboardedAt: string | null;
  readonly onboardedBy: string | null;
  readonly suspendedAt: string | null;
  readonly suspendedBy: string | null;
  readonly suspendedReason: string | null;
  readonly deletedAt: string | null;
}

@Injectable({ providedIn: 'root' })
export class CatalogClientService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private base(): string {
    const principal = this.auth.principal();
    if (!principal) throw new Error('Not authenticated');
    return `${environment.catalogBaseUrl}/v1/catalogs/${encodeURIComponent(principal.tenantId)}`;
  }

  listCapabilities(query: { kind?: string; lifecycle?: string; limit?: number; offset?: number } = {}): Observable<CapabilityListResponse> {
    let params = new HttpParams();
    if (query.kind) params = params.set('kind', query.kind);
    if (query.lifecycle) params = params.set('lifecycle', query.lifecycle);
    if (query.limit !== undefined) params = params.set('limit', String(query.limit));
    if (query.offset !== undefined) params = params.set('offset', String(query.offset));
    return this.http.get<CapabilityListResponse>(`${this.base()}/capabilities`, { params });
  }

  createCapability(input: {
    kind: string;
    name: string;
    body: Record<string, unknown>;
    lifecycle?: 'draft' | 'published' | 'deprecated' | 'disabled';
    owner?: string | null;
    tags?: readonly string[];
    requiredHostVersion?: string | null;
  }): Observable<Capability> {
    return this.http.post<Capability>(`${this.base()}/capabilities`, input);
  }

  patchCapability(id: string, patch: {
    lifecycle?: 'draft' | 'published' | 'deprecated' | 'disabled';
    owner?: string | null;
    tags?: readonly string[];
    body?: Record<string, unknown>;
    requiredHostVersion?: string | null;
  }): Observable<Capability> {
    return this.http.patch<Capability>(`${this.base()}/capabilities/${encodeURIComponent(id)}`, patch);
  }

  deleteCapability(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base()}/capabilities/${encodeURIComponent(id)}`);
  }

  listMfes(): Observable<{ items: readonly MfeRemote[] }> {
    return this.http.get<{ items: readonly MfeRemote[] }>(`${this.base()}/mfes`);
  }

  listRoleMappings(): Observable<{ items: readonly RoleMapping[] }> {
    return this.http.get<{ items: readonly RoleMapping[] }>(`${this.base()}/role-mappings`);
  }

  verifyAuditChain(): Observable<AuditVerifyResult> {
    return this.http.get<AuditVerifyResult>(`${this.base()}/audit/verify`);
  }

  /**
   * Fetches the JSONL stream as text. Caller-side download is
   * triggered via Blob URL; the server sets the
   * Content-Disposition header so a direct browser navigation
   * also works (the in-app download keeps the user inside the
   * console).
   */
  exportAudit(query: { from?: string; to?: string; limit?: number } = {}): Observable<string> {
    let params = new HttpParams();
    if (query.from) params = params.set('from', query.from);
    if (query.to) params = params.set('to', query.to);
    if (query.limit !== undefined) params = params.set('limit', String(query.limit));
    return this.http.get(`${this.base()}/audit/export`, {
      params,
      responseType: 'text',
    });
  }

  aggregateUsage(query: { from?: string; to?: string; kind?: string } = {}): Observable<UsageAggregate> {
    let params = new HttpParams();
    if (query.from) params = params.set('from', query.from);
    if (query.to) params = params.set('to', query.to);
    if (query.kind) params = params.set('kind', query.kind);
    return this.http.get<UsageAggregate>(`${this.base()}/usage`, { params });
  }

  recentUsage(limit = 50): Observable<{ items: readonly UsageEvent[] }> {
    const params = new HttpParams().set('limit', String(limit));
    return this.http.get<{ items: readonly UsageEvent[] }>(`${this.base()}/usage/recent`, { params });
  }

  // ── Tenant lifecycle (platform-admin only) ─────────────────────
  // Tenants are platform-level; the client does NOT scope these
  // requests to the principal's tenant.
  listTenants(includeDeleted = false): Observable<{ items: readonly Tenant[] }> {
    const params = includeDeleted ? new HttpParams().set('includeDeleted', 'true') : new HttpParams();
    return this.http.get<{ items: readonly Tenant[] }>(
      `${environment.catalogBaseUrl}/v1/tenants`,
      { params },
    );
  }

  getTenant(id: string): Observable<Tenant> {
    return this.http.get<Tenant>(`${environment.catalogBaseUrl}/v1/tenants/${encodeURIComponent(id)}`);
  }

  createTenant(input: { id: string; displayName: string; quotas?: Record<string, unknown> }): Observable<Tenant> {
    return this.http.post<Tenant>(`${environment.catalogBaseUrl}/v1/tenants`, input);
  }

  patchTenant(id: string, patch: { displayName?: string; quotas?: Record<string, unknown> }): Observable<Tenant> {
    return this.http.patch<Tenant>(
      `${environment.catalogBaseUrl}/v1/tenants/${encodeURIComponent(id)}`,
      patch,
    );
  }

  suspendTenant(id: string, reason: string): Observable<Tenant> {
    return this.http.post<Tenant>(
      `${environment.catalogBaseUrl}/v1/tenants/${encodeURIComponent(id)}/suspend`,
      { reason },
    );
  }

  activateTenant(id: string): Observable<Tenant> {
    return this.http.post<Tenant>(
      `${environment.catalogBaseUrl}/v1/tenants/${encodeURIComponent(id)}/activate`,
      {},
    );
  }

  deleteTenant(id: string): Observable<void> {
    return this.http.delete<void>(`${environment.catalogBaseUrl}/v1/tenants/${encodeURIComponent(id)}`);
  }
}
