import { describe, expect, it } from 'vitest';
import { capabilityMutationMatches, type CatalogMutation } from './catalog-client';

const cap = (over: Partial<CatalogMutation> = {}): CatalogMutation => ({ entityType: 'capability', ...over });

describe('capabilityMutationMatches (targeted SSE re-hydrate)', () => {
  it('fires when the resolved kind matches the source kind', () => {
    expect(capabilityMutationMatches(cap({ kind: 'form' }), 'form')).toBe(true);
  });

  it('skips when the resolved kind is a different kind (the whole point — no needless re-hydrate)', () => {
    expect(capabilityMutationMatches(cap({ kind: 'decision' }), 'form')).toBe(false);
    expect(capabilityMutationMatches(cap({ kind: 'tool' }), 'workflow')).toBe(false);
  });

  it('falls back to broad refresh when the kind is unknown (delete / no id / lookup failed)', () => {
    // A delete or a failed lookup leaves kind undefined → every source must re-hydrate
    // so the removed row actually leaves its registry.
    expect(capabilityMutationMatches(cap({ operation: 'delete' }), 'form')).toBe(true);
    expect(capabilityMutationMatches(cap({ kind: undefined }), 'decision')).toBe(true);
  });

  it('never fires for an experience mutation (handled by a separate listener)', () => {
    expect(capabilityMutationMatches({ entityType: 'experience' }, 'form')).toBe(false);
    expect(capabilityMutationMatches({ entityType: 'experience', kind: 'form' }, 'form')).toBe(false);
  });
});
