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
