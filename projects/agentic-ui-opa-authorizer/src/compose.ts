/**
 * Pure composition helper, split into its own file with NO Angular
 * imports so it's testable via plain vitest. The full
 * `provideOpaAuthorizer` integration in `index.ts` re-exports this.
 *
 * Slice OPA-B / ADR-040.
 */

/** Sub-shape of `RegistryEntry` we actually read here. */
export interface ScopeTarget {
  readonly name: string;
}

/**
 * Compose an existing scope policy with OPA decisions. Returned
 * policy is the AND of (a) cached OPA decision and (b) `inner(entry)`.
 *
 * @param inner the existing scope policy (e.g. persona policy + catalog
 *              authorizer's policy that the OPA plugin is wrapping).
 * @param decide synchronous accessor over the OPA decision cache —
 *               returns true if allowed, false if denied. Cache misses
 *               are handled by the service's onMiss default.
 * @param registryKind 'tool' or 'component' — passed to `decide` so
 *                     the cache key stays stable.
 */
export function composeWithOpaAuthorizer<E extends ScopeTarget>(
  inner: (entry: E) => boolean,
  decide: (kind: 'tool' | 'component', name: string) => boolean,
  registryKind: 'tool' | 'component',
): (entry: E) => boolean {
  return (entry) => {
    if (!decide(registryKind, entry.name)) return false;
    return inner(entry);
  };
}
