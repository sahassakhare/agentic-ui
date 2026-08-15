import { describe, expect, it } from 'vitest';
import { decodeTenant } from './auth.service';

/** Build an unsigned JWT with the given payload (header.payload.sig). */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

describe('decodeTenant', () => {
  it('reads tenant_id from a JWT', () => {
    expect(decodeTenant(jwt({ tenant_id: 'acme', sub: 'u1' }))).toBe('acme');
  });

  it('falls back to tenantId', () => {
    expect(decodeTenant(jwt({ tenantId: 'globex' }))).toBe('globex');
  });

  it('returns null for a token with no tenant claim', () => {
    expect(decodeTenant(jwt({ sub: 'u1' }))).toBeNull();
  });

  it('returns null for a malformed token', () => {
    expect(decodeTenant('not-a-jwt')).toBeNull();
    expect(decodeTenant('')).toBeNull();
  });
});
