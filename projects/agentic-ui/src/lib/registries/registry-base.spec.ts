import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from './tool-registry';
import { ComponentRegistry } from './component-registry';
import { agenticTool } from '../factories/agentic-tool';
import type { ToolDef } from '../types/registry-defs';

describe('RegistryBase via ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(ToolRegistry);
  });

  function makeTool(name: string, source?: 'host' | `remote:${string}`): ToolDef {
    return agenticTool({
      name,
      description: `tool ${name}`,
      schema: z.object({}),
      handler: async () => undefined,
    }) as ToolDef;
    void source;
  }

  it('register adds an entry and returns a disposer', () => {
    const tool = makeTool('alpha');
    const dispose = registry.register(tool);
    expect(registry.list().map((t) => t.name)).toEqual(['alpha']);
    dispose();
    expect(registry.list()).toEqual([]);
  });

  it('register replaces an entry of the same name', () => {
    registry.register(makeTool('alpha'));
    registry.register(makeTool('alpha'));
    expect(registry.list()).toHaveLength(1);
  });

  it('signal emits reactive snapshot', () => {
    expect(registry.signal()).toEqual([]);
    registry.register(makeTool('a'));
    registry.register(makeTool('b'));
    expect(registry.signal().map((t) => t.name).sort()).toEqual(['a', 'b']);
  });

  it('removeBySource drops only matching entries', () => {
    registry.register({ ...makeTool('a'), source: 'host' });
    registry.register({ ...makeTool('b'), source: 'remote:bookings' });
    registry.register({ ...makeTool('c'), source: 'remote:bookings' });
    registry.register({ ...makeTool('d'), source: 'remote:loyalty' });

    registry.removeBySource('remote:bookings');
    expect(registry.list().map((t) => t.name).sort()).toEqual(['a', 'd']);
  });

  it('registerAll returns a single disposer that drops every entry', () => {
    const dispose = registry.registerAll([makeTool('x'), makeTool('y'), makeTool('z')]);
    expect(registry.list()).toHaveLength(3);
    dispose();
    expect(registry.list()).toEqual([]);
  });
});

describe('ComponentRegistry', () => {
  it('shares the same RegistryBase semantics independently of ToolRegistry', () => {
    TestBed.configureTestingModule({});
    const tools = TestBed.inject(ToolRegistry);
    const components = TestBed.inject(ComponentRegistry);
    tools.register(agenticTool({
      name: 'a',
      description: 'shared name',
      schema: z.object({}),
      handler: async () => undefined,
    }) as ToolDef);
    components.register({ name: 'a', component: class {} as never, propsSchema: z.object({}) });
    expect(tools.list()).toHaveLength(1);
    expect(components.list()).toHaveLength(1);
    expect(tools.get('a')).toBeDefined();
    expect(components.get('a')).toBeDefined();
  });
});

describe('RegistryBase conflict policies', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(ToolRegistry);
  });

  function makeTool(name: string, description = `tool ${name}`): ToolDef {
    return agenticTool({
      name,
      description,
      schema: z.object({}),
      handler: async () => undefined,
    }) as ToolDef;
  }

  it("default policy 'replace' overwrites an existing entry of the same name", () => {
    registry.register(makeTool('alpha', 'first'));
    registry.register(makeTool('alpha', 'second'));
    expect(registry.list()).toHaveLength(1);
    expect(registry.get('alpha')?.description).toBe('second');
  });

  it("'throw' policy raises with both source ids in the error message", () => {
    registry.conflictPolicy = 'throw';
    registry.register({ ...makeTool('alpha'), source: 'remote:bookings' });
    expect(() => registry.register({ ...makeTool('alpha'), source: 'remote:legacy' })).toThrow(/already registered/);
    expect(registry.list()).toHaveLength(1);
    expect(registry.get('alpha')?.source).toBe('remote:bookings');
  });

  it("'first-wins' policy keeps the existing entry and returns a no-op disposer for the loser", () => {
    registry.conflictPolicy = 'first-wins';
    registry.register(makeTool('alpha', 'original'));
    const loserDispose = registry.register(makeTool('alpha', 'usurper'));
    expect(registry.get('alpha')?.description).toBe('original');
    // Calling the no-op disposer must NOT remove the kept entry.
    loserDispose();
    expect(registry.list()).toHaveLength(1);
    expect(registry.get('alpha')?.description).toBe('original');
  });

  it("'namespace' policy prefixes the new entry with the remote source", () => {
    registry.conflictPolicy = 'namespace';
    registry.register({ ...makeTool('bookFlight'), source: 'remote:bookings' });
    registry.register({ ...makeTool('bookFlight'), source: 'remote:legacy' });
    const names = registry.list().map((t) => t.name).sort();
    expect(names).toEqual(['bookFlight', 'legacy.bookFlight']);
  });

  it("'namespace' policy falls through to replace when source is host", () => {
    registry.conflictPolicy = 'namespace';
    registry.register({ ...makeTool('alpha', 'first'), source: 'host' });
    registry.register({ ...makeTool('alpha', 'second'), source: 'host' });
    expect(registry.list()).toHaveLength(1);
    expect(registry.get('alpha')?.description).toBe('second');
  });
});

describe('RegistryBase onDispose lifecycle hook', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(ToolRegistry);
  });

  function makeTool(name: string, onDispose?: () => void | Promise<void>): ToolDef {
    return {
      ...(agenticTool({
        name,
        description: `tool ${name}`,
        schema: z.object({}),
        handler: async () => undefined,
      }) as ToolDef),
      onDispose,
    };
  }

  it('explicit disposer invokes onDispose', async () => {
    let called = false;
    const dispose = registry.register(makeTool('alpha', () => { called = true; }));
    dispose();
    // Microtask flush — runDispose awaits asynchronously.
    await Promise.resolve();
    expect(called).toBe(true);
    expect(registry.list()).toEqual([]);
  });

  it('removeBySource fires onDispose for every dropped entry', async () => {
    const calls: string[] = [];
    registry.register({ ...makeTool('a', () => { calls.push('a'); }), source: 'remote:bookings' });
    registry.register({ ...makeTool('b', () => { calls.push('b'); }), source: 'remote:bookings' });
    registry.register({ ...makeTool('c', () => { calls.push('c'); }), source: 'remote:loyalty' });
    registry.removeBySource('remote:bookings');
    await Promise.resolve();
    expect(calls.sort()).toEqual(['a', 'b']);
    expect(registry.list().map((t) => t.name)).toEqual(['c']);
  });

  it("'replace' policy fires the displaced entry's onDispose before storing the new one", async () => {
    let disposed = false;
    registry.register(makeTool('alpha', () => { disposed = true; }));
    registry.register(makeTool('alpha'));   // no hook on the replacement
    await Promise.resolve();
    expect(disposed).toBe(true);
    expect(registry.list()).toHaveLength(1);
  });

  it('onDispose throwing does not poison a removeBySource sweep', async () => {
    let secondCalled = false;
    registry.register({
      ...makeTool('a', () => { throw new Error('boom'); }),
      source: 'remote:bookings',
    });
    registry.register({
      ...makeTool('b', () => { secondCalled = true; }),
      source: 'remote:bookings',
    });
    expect(() => registry.removeBySource('remote:bookings')).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(secondCalled).toBe(true);
    expect(registry.list()).toEqual([]);
  });

  // ─── Scope policy (Phase 8) ──────────────────────────────────────────

  describe('scope policy', () => {
    function scoped(name: string, scopes: readonly string[] | undefined): ToolDef {
      return { ...makeTool(name), scopes } as ToolDef;
    }

    it('default policy shows every entry', () => {
      registry.register(makeTool('alpha'));
      registry.register(scoped('beta', ['lead-counsel']));
      expect(registry.list().map((t) => t.name).sort()).toEqual(['alpha', 'beta']);
    });

    it('hides entries the policy rejects', () => {
      registry.register(scoped('public', undefined));
      registry.register(scoped('counsel', ['lead-counsel']));
      registry.register(scoped('paralegal', ['paralegal']));
      registry.setScopePolicy((entry) =>
        !entry.scopes || entry.scopes.includes('paralegal'));
      expect(registry.list().map((t) => t.name).sort()).toEqual(['paralegal', 'public']);
    });

    it('get() honours the policy — hidden entries read as undefined', () => {
      registry.register(scoped('counsel-only', ['lead-counsel']));
      registry.setScopePolicy((entry) =>
        !entry.scopes || entry.scopes.includes('paralegal'));
      expect(registry.get('counsel-only')).toBeUndefined();
    });

    it('getRaw / listRaw bypass the policy', () => {
      registry.register(scoped('counsel-only', ['lead-counsel']));
      registry.setScopePolicy(() => false);
      expect(registry.list()).toEqual([]);
      expect(registry.listRaw()).toHaveLength(1);
      expect(registry.getRaw('counsel-only')?.name).toBe('counsel-only');
    });

    it('register() detects collisions against hidden entries (raw entries)', () => {
      registry.conflictPolicy = 'throw';
      registry.register(scoped('hidden', ['ghost-scope']));
      registry.setScopePolicy(() => false);   // hide everything
      // Hidden but still present — collision should still fire.
      expect(() => registry.register(scoped('hidden', undefined))).toThrow(/already registered/);
    });

    it('signal recomputes when the policy changes', () => {
      registry.register(scoped('alpha', undefined));
      registry.register(scoped('beta', ['lead-counsel']));
      const sig = registry.signal;
      expect(sig().map((t) => t.name).sort()).toEqual(['alpha', 'beta']);
      registry.setScopePolicy((entry) =>
        !entry.scopes || entry.scopes.includes('paralegal'));
      expect(sig().map((t) => t.name)).toEqual(['alpha']);
    });

    it('activeScopePolicy: scope-less entries are visible', async () => {
      const { activeScopePolicy } = await import('./registry-base');
      registry.register(scoped('public', undefined));
      registry.register(scoped('counsel', ['lead-counsel']));
      registry.setScopePolicy(activeScopePolicy(() => 'paralegal'));
      expect(registry.list().map((t) => t.name)).toEqual(['public']);
    });

    it('activeScopePolicy: matching active scope shows the entry', async () => {
      const { activeScopePolicy } = await import('./registry-base');
      registry.register(scoped('counsel', ['lead-counsel']));
      registry.register(scoped('paralegal', ['paralegal']));
      let active = 'paralegal';
      registry.setScopePolicy(activeScopePolicy(() => active));
      expect(registry.list().map((t) => t.name)).toEqual(['paralegal']);
      active = 'lead-counsel';
      registry.setScopePolicy(activeScopePolicy(() => active));
      expect(registry.list().map((t) => t.name)).toEqual(['counsel']);
    });
  });
});
