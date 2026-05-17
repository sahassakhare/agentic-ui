import { z } from 'zod';

/**
 * Authenticated principal — derived from the validated JWT. Threaded
 * through every authenticated route via Hono context. RLS uses
 * `tenantId` to scope queries.
 */
export const PrincipalSchema = z.object({
  /** Subject from the JWT (`sub` claim). Stable across the principal's lifetime. */
  subject: z.string().min(1),
  /** Tenant scope. Either matches `path.tenant` or principal must be `platform-admin`. */
  tenantId: z.string().min(1),
  /** Display name from the JWT (`name` or `preferred_username`). For audit attribution. */
  displayName: z.string().min(1),
  /** Roles granted by the IdP — typically pulled from a custom claim like `roles`. */
  roles: z.array(z.string()),
  /** Issuer the JWT came from (`iss` claim). */
  issuer: z.string(),
});
export type Principal = z.infer<typeof PrincipalSchema>;

/** Convenience: is this principal allowed to bypass tenant-scope checks? */
export function isPlatformAdmin(p: Principal): boolean {
  return p.roles.includes('platform-admin');
}

/** Audit-attribution string. `subject@issuer` keeps it unique across IdPs. */
export function auditActor(p: Principal): string {
  return `${p.subject}@${p.issuer}`;
}
