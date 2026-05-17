import { describe, expect, it } from 'vitest';
import { extractClaimValues, readJwtPayload, readTenantId } from './jwt-claims';

function mintToken(payload: object): string {
  const header = base64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const body = base64Url(JSON.stringify(payload));
  return `${header}.${body}.fake-signature`;
}

function base64Url(s: string): string {
  // UTF-8-safe: encode bytes first, then map to a binary string for btoa.
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('readJwtPayload', () => {
  it('parses a well-formed JWT payload', () => {
    const t = mintToken({ sub: 'u1', tenant_id: 'acme', groups: ['eng'] });
    const p = readJwtPayload(t);
    expect(p).toMatchObject({ sub: 'u1', tenant_id: 'acme', groups: ['eng'] });
  });

  it('returns null for non-JWT strings', () => {
    expect(readJwtPayload('not.a.jwt.at.all')).toBeNull();
    expect(readJwtPayload('only-one-segment')).toBeNull();
    expect(readJwtPayload('')).toBeNull();
  });

  it('returns null for malformed payload segment', () => {
    expect(readJwtPayload('aaa.!!!notbase64!!!.bbb')).toBeNull();
  });

  it('returns null when payload is not an object', () => {
    const t = `aaa.${base64Url('"just-a-string"')}.bbb`;
    expect(readJwtPayload(t)).toBeNull();
  });

  it('round-trips UTF-8 payload contents', () => {
    const t = mintToken({ name: 'Zoë — Lëǵal' });
    const p = readJwtPayload(t);
    expect(p?.['name']).toBe('Zoë — Lëǵal');
  });
});

describe('extractClaimValues', () => {
  it('returns array values verbatim, filtering non-strings', () => {
    expect(extractClaimValues({ groups: ['a', 'b', 1 as unknown as string] }, 'groups'))
      .toEqual(['a', 'b']);
  });

  it('splits comma-separated strings into a list', () => {
    expect(extractClaimValues({ groups: 'a, b ,c' }, 'groups')).toEqual(['a', 'b', 'c']);
  });

  it('wraps a single string in an array', () => {
    expect(extractClaimValues({ groups: 'engineering' }, 'groups')).toEqual(['engineering']);
  });

  it('returns [] for missing or empty claims', () => {
    expect(extractClaimValues({}, 'groups')).toEqual([]);
    expect(extractClaimValues({ groups: '' }, 'groups')).toEqual([]);
    expect(extractClaimValues(null, 'groups')).toEqual([]);
  });

  it('returns [] for objects (no deep traversal)', () => {
    expect(extractClaimValues({ groups: { nested: ['x'] } }, 'groups')).toEqual([]);
  });
});

describe('readTenantId', () => {
  it('reads the default tenant_id claim', () => {
    expect(readTenantId({ tenant_id: 'acme' })).toBe('acme');
  });

  it('honours a custom tenant claim name', () => {
    expect(readTenantId({ org: 'acme' }, 'org')).toBe('acme');
  });

  it('returns null when missing', () => {
    expect(readTenantId({})).toBeNull();
    expect(readTenantId(null)).toBeNull();
    expect(readTenantId({ tenant_id: '' })).toBeNull();
  });
});
