import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export type ApprovalState = 'draft' | 'review' | 'approved' | 'rejected' | 'deprecated';
export type ApprovalAction = 'submit' | 'approve' | 'reject' | 'revoke' | 'deprecate';

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
  /** Optimistic-concurrency token; sent back as `If-Match` on the next write. */
  readonly version: number;
  readonly approvalState: ApprovalState;
  readonly approvalChain: readonly ApprovalEvent[];
  /** Authoring provenance: distinguishes AI-assisted drafts. Absent is treated as 'human'. */
  readonly authoredBy?: 'human' | 'ai-assisted';
  readonly createdAt: string;
  readonly updatedAt?: string;
  readonly softDeletedAt: string | null;
}

export interface ApprovalEvent {
  readonly id: string;
  readonly timestamp: string;
  readonly actor: { readonly userId: string; readonly displayName?: string };
  readonly action: ApprovalAction;
  readonly fromState: ApprovalState;
  readonly toState: ApprovalState;
  readonly comment?: string;
}

/** An immutable version snapshot from `/capabilities/:id/versions`. */
export interface CapabilityVersion {
  readonly versionNo: number;
  readonly snapshot: Record<string, unknown>;
  readonly reason: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface CapabilityListResponse {
  readonly items: readonly Capability[];
  readonly total: number;
}

/** Thrown when a write is rejected because the capability changed underneath us (HTTP 412). */
export class ConcurrencyError extends Error {
  constructor() { super('This capability was changed by someone else — reload and retry.'); this.name = 'ConcurrencyError'; }
}

/**
 * Typed client for the catalog `/capabilities` API. Enterprise governance:
 * optimistic concurrency (`If-Match` = the loaded `version`, 412 → ConcurrencyError),
 * an approval review chain (`transition`), and version history (`versions`/`rollback`).
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

  get(id: string): Observable<Capability> {
    return this.http.get<Capability>(`${this.base()}/${id}`);
  }

  create(input: { kind: string; name: string; body: Record<string, unknown>; tags?: string[]; authoredBy?: 'human' | 'ai-assisted' }): Observable<Capability> {
    return this.http.post<Capability>(this.base(), input);
  }

  /**
   * Update a capability's body/lifecycle/tags. Pass the loaded `version` to enable
   * optimistic concurrency — a stale write rejects with {@link ConcurrencyError}.
   * Publishing (`lifecycle: 'published'`) is gated server-side on approval (409).
   */
  update(
    id: string,
    patch: { body?: Record<string, unknown>; lifecycle?: string; tags?: string[] },
    version?: number,
  ): Observable<Capability> {
    const options = version != null
      ? { headers: new HttpHeaders({ 'If-Match': `"${version}"` }) }
      : {};
    return this.http.patch<Capability>(`${this.base()}/${id}`, patch, options).pipe(mapConflict());
  }

  /** Drive the approval review chain (submit/approve/reject/revoke/deprecate). */
  transition(id: string, action: ApprovalAction, comment?: string): Observable<Capability> {
    return this.http.post<Capability>(`${this.base()}/${id}/transition`, { action, comment });
  }

  /** The version history (newest first). */
  versions(id: string): Observable<{ items: readonly CapabilityVersion[] }> {
    return this.http.get<{ items: readonly CapabilityVersion[] }>(`${this.base()}/${id}/versions`);
  }

  /** Restore a prior version's content (re-enters the review chain as draft). */
  rollback(id: string, versionNo: number): Observable<Capability> {
    return this.http.post<Capability>(`${this.base()}/${id}/rollback/${versionNo}`, {});
  }

  remove(id: string, version?: number): Observable<void> {
    const options = version != null
      ? { headers: new HttpHeaders({ 'If-Match': `"${version}"` }) }
      : {};
    return this.http.delete<void>(`${this.base()}/${id}`, options).pipe(mapConflict());
  }
}

/** Map a 412 Precondition Failed into a typed ConcurrencyError. */
function mapConflict<T>() {
  return catchError<T, Observable<T>>((err: unknown) => {
    if (err instanceof HttpErrorResponse && err.status === 412) return throwError(() => new ConcurrencyError());
    return throwError(() => err);
  });
}
