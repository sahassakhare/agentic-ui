import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

/** Wire shapes returned by the catalog `/experiences` API (Seam F). */
export interface CapabilityRequirement {
  readonly kind: string;
  readonly name?: string;
  readonly tag?: string;
  readonly optional?: boolean;
  readonly reason?: string;
}

export interface ExperienceBody {
  readonly intents?: readonly string[];
  readonly requires?: readonly CapabilityRequirement[];
  readonly produces?: readonly string[];
  readonly defaultLayout?: string;
  readonly policies?: readonly string[];
  readonly personas?: readonly string[];
  readonly scopes?: readonly string[];
}

export type ApprovalState = 'draft' | 'review' | 'approved' | 'rejected' | 'deprecated';
export type ApprovalAction = 'submit' | 'approve' | 'reject' | 'deprecate' | 'revoke';

export interface Experience {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly title: string;
  readonly goal: string;
  readonly body: ExperienceBody;
  readonly approvalState: ApprovalState;
  readonly approvalChain: readonly unknown[];
  readonly owner: string | null;
  readonly tags: readonly string[];
  readonly version: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
  readonly softDeletedAt: string | null;
}

export interface ExperienceListResponse {
  readonly items: readonly Experience[];
  readonly total: number;
}

export interface ExperiencePlanResult {
  readonly experienceId: string;
  readonly goal: string;
  readonly approvalState: ApprovalState;
  readonly matched: readonly { kind: string; name: string }[];
  readonly unmet: readonly { kind: string; name?: string; tag?: string }[];
  readonly complete: boolean;
}

/** An active publication of an approved experience (headless embed). */
export interface Publication {
  readonly id: string;
  readonly experienceId: string;
  readonly experienceName: string;
  readonly publishedVersionNo: number;
  readonly keyPrefix: string;
  readonly allowedOrigins: readonly string[];
  readonly status: 'active' | 'revoked';
  readonly publishedAt: string;
  readonly publishedBy: string;
}
/** Publish/rotate responses carry the RAW embed key exactly once. */
export interface PublishResult { readonly publication: Publication; readonly embedKey: string; }
export interface RotateKeyResult { readonly embedKey: string; readonly keyPrefix: string; readonly publication: Publication; }

/**
 * Typed client for the catalog `/experiences` API (AEP Seam F). The studio's
 * only backend dependency — it talks to the same catalog server as the ops
 * console over HTTP, reusing no ops-console code.
 */
@Injectable({ providedIn: 'root' })
export class ExperienceCatalogService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private base(): string {
    const tenant = this.auth.tenant() ?? 'default';
    return `${environment.catalogBaseUrl}/v1/catalogs/${encodeURIComponent(tenant)}/experiences`;
  }

  list(opts: { approvalState?: ApprovalState; tag?: string; q?: string } = {}): Observable<ExperienceListResponse> {
    let params = new HttpParams();
    if (opts.approvalState) params = params.set('approvalState', opts.approvalState);
    if (opts.tag) params = params.set('tag', opts.tag);
    if (opts.q) params = params.set('q', opts.q);
    return this.http.get<ExperienceListResponse>(this.base(), { params });
  }

  get(id: string): Observable<Experience> {
    return this.http.get<Experience>(`${this.base()}/${id}`);
  }

  create(input: { name: string; title: string; goal: string; body?: ExperienceBody; tags?: string[] }): Observable<Experience> {
    return this.http.post<Experience>(this.base(), input);
  }

  update(id: string, patch: Partial<{ title: string; goal: string; body: ExperienceBody; tags: string[] }>): Observable<Experience> {
    return this.http.patch<Experience>(`${this.base()}/${id}`, patch);
  }

  transition(id: string, action: ApprovalAction, comment?: string): Observable<Experience> {
    return this.http.post<Experience>(`${this.base()}/${id}/transition`, { action, comment });
  }

  plan(id: string): Observable<ExperiencePlanResult> {
    return this.http.post<ExperiencePlanResult>(`${this.base()}/${id}/plan`, {});
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base()}/${id}`);
  }

  // ── Publishing (headless embed) ────────────────────────────────────────────
  getPublication(id: string): Observable<{ publication: Publication | null }> {
    return this.http.get<{ publication: Publication | null }>(`${this.base()}/${id}/publication`);
  }
  publish(id: string, allowedOrigins: string[]): Observable<PublishResult> {
    return this.http.post<PublishResult>(`${this.base()}/${id}/publish`, { allowedOrigins });
  }
  unpublish(id: string): Observable<{ status: string; publication: Publication }> {
    return this.http.post<{ status: string; publication: Publication }>(`${this.base()}/${id}/unpublish`, {});
  }
  rotateKey(id: string): Observable<RotateKeyResult> {
    return this.http.post<RotateKeyResult>(`${this.base()}/${id}/publish/rotate-key`, {});
  }
}
