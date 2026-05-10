import { describe, expect, it } from 'vitest';
import { composeWithOpaAuthorizer } from './compose.js';

/**
 * Pure-function unit tests for the OPA plugin's composition logic.
 *
 * `composeWithOpaAuthorizer` lives in `./compose.ts` with NO Angular
 * imports so it's testable via plain vitest. The full DI integration
 * (`OpaAuthorizerService`, `provideOpaAuthorizer`) requires a TestBed
 * harness with zone.js + Angular bootstrap; those are exercised by:
 *
 * 1. The plugin's TypeScript build (catches public-API drift).
 * 2. The lib's dist resolves cleanly (catches peer-dep drift).
 * 3. Adopter integration tests when they wire the plugin into their
 *    own app (the plugin is opt-in; there's no in-tree app that
 *    currently consumes it).
 *
 * The pure helper is the load-bearing decision-composition logic.
 */
describe('composeWithOpaAuthorizer', () => {
  it('AND-composes the inner policy with the OPA decide() function', () => {
    const inner = (entry: { name: string }) => entry.name !== 'inner-blocked';
    const denied = new Set(['opa-denied']);
    const composed = composeWithOpaAuthorizer(
      inner,
      (_kind, name) => !denied.has(name),
      'tool',
    );
    expect(composed({ name: 'visible' })).toBe(true);
    expect(composed({ name: 'opa-denied' })).toBe(false);   // OPA denies
    expect(composed({ name: 'inner-blocked' })).toBe(false); // inner denies
  });

  it('passes the registry kind to decide() so cache keys stay stable across kinds', () => {
    const seen: Array<{ kind: string; name: string }> = [];
    const composed = composeWithOpaAuthorizer(
      () => true,
      (kind, name) => { seen.push({ kind, name }); return true; },
      'component',
    );
    composed({ name: 'flightCard' });
    expect(seen).toEqual([{ kind: 'component', name: 'flightCard' }]);
  });

  it('short-circuits on opa-deny — inner policy is not consulted', () => {
    let innerCalled = false;
    const composed = composeWithOpaAuthorizer(
      () => { innerCalled = true; return true; },
      () => false,
      'tool',
    );
    expect(composed({ name: 'x' })).toBe(false);
    expect(innerCalled).toBe(false);
  });

  it('inner-allow + opa-allow → visible', () => {
    const composed = composeWithOpaAuthorizer(
      () => true,
      () => true,
      'tool',
    );
    expect(composed({ name: 'allowed' })).toBe(true);
  });
});
