// The lib dist ships partially-compiled (Angular Linker) declarations; load
// the JIT compiler so `Injector.create`-instantiated services from the lib
// barrel compile at runtime in this plain-vitest (no-TestBed) harness.
import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { Injector, computed } from '@angular/core';
import { AGENTIC_TELEMETRY_SINK } from '@infra-tools/agentic-ui';
import { composeWithOpaAuthorizer } from './compose.js';
import { OpaAuthorizerService } from './index.js';

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

/**
 * Reactive-propagation regression test for `OpaAuthorizerService`.
 *
 * The registry's filtered view is a `computed` that calls the scope policy
 * (→ `decide`). A background OPA decision that flips to *deny* after the
 * first `onMiss: 'allow'` read MUST cause that computed to re-evaluate and
 * hide the entry — otherwise a denied tool stays visible until something
 * unrelated invalidates the registry. `decide` reads the `cacheVersion`
 * signal precisely so the tracking computed depends on it. Without that
 * read, the `visible()` recompute below never returns `false`.
 *
 * Uses `Injector.create` (no TestBed/zone needed — signals are zoneless;
 * only the service's `inject()` calls need an injection context).
 */
describe('OpaAuthorizerService — reactive decision propagation', () => {
  const sink = { emit() {}, counter() {}, histogram() {}, startSpan() { return { end() {}, recordError() {}, setAttribute() {} }; } };

  it('re-evaluates a tracking computed when a background decision flips to deny', async () => {
    const injector = Injector.create({
      providers: [
        { provide: AGENTIC_TELEMETRY_SINK, useValue: sink },
        { provide: OpaAuthorizerService },
      ],
    });
    const svc = injector.get(OpaAuthorizerService);

    // OPA denies every decision; the call resolves on the next microtask.
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ allow: false }),
    })) as unknown as typeof fetch;
    svc.configure({
      catalogUrl: 'https://catalog.example.com',
      tenantId: 'acme',
      getToken: () => null,
      onMiss: 'allow',
      cacheTtlMs: 60_000,
      fetchFn,
    });

    // Stand-in for a registry's filtered computed: it filters via the policy.
    const visible = computed(() => svc.decide('tool', 'bookFlight'));

    // First read: cache miss → onMiss 'allow' → visible; fires a background fetch.
    expect(visible()).toBe(true);

    // Once the deny lands + bumps cacheVersion, the computed recomputes.
    await vi.waitFor(() => expect(visible()).toBe(false));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
