/**
 * Best-effort JWT-payload reader. **Does not** verify the signature —
 * signature verification is the catalog server's job (the runtime
 * adapter just needs the claim values to post to `/resolve`).
 *
 * Returns `null` when the token is not a well-formed JWT. Callers
 * should fall back to a default persona in that case rather than
 * crashing.
 *
 * Inputs trusted to the extent of "this came from our IdP and the
 * server we hand it to verifies it." We do NOT log payload contents
 * here — payloads can carry PII.
 */
export function readJwtPayload(token: string): Record<string, unknown> | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const payload = parts[1];
  if (!payload) return null;
  try {
    const decoded = base64UrlDecode(payload);
    const parsed = JSON.parse(decoded) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Pull a list of string values from a JWT claim. Tolerates the three
 * common shapes:
 *
 * - `groups: ["a", "b"]`            → `["a", "b"]`
 * - `groups: "a,b,c"`               → `["a", "b", "c"]`
 * - `groups: "a"`                   → `["a"]`
 *
 * Returns `[]` for missing / malformed claims (which then cause the
 * resolve endpoint to return a `null` persona — the default-fallback
 * path).
 *
 * `claimPath` is treated as a literal top-level key today. Nested
 * paths (e.g. `https://my.domain/claims.groups`) are also literal —
 * we don't dot-traverse. If the host needs nested traversal, supply
 * a custom `claimValuesExtractor` to `provideCatalogActivePersona`.
 */
export function extractClaimValues(
  payload: Record<string, unknown> | null,
  claimPath: string,
): readonly string[] {
  if (!payload) return [];
  const raw = payload[claimPath];
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
  }
  if (typeof raw === 'string') {
    if (raw.length === 0) return [];
    if (raw.includes(',')) {
      return raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    }
    return [raw];
  }
  return [];
}

/**
 * Read the tenant id out of a JWT payload. Defaults to the
 * `tenant_id` claim, but the catalog server's
 * `OIDC_TENANT_CLAIM` config is mirrored here so hosts using a
 * different claim name can match.
 */
export function readTenantId(
  payload: Record<string, unknown> | null,
  tenantClaim = 'tenant_id',
): string | null {
  if (!payload) return null;
  const v = payload[tenantClaim];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function base64UrlDecode(input: string): string {
  // base64url → base64. Pad to a multiple of 4.
  const normalised = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  // atob returns a binary-string; decode UTF-8 properly.
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
