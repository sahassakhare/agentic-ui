import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { z } from 'zod';
import { DataSourceRegistry } from './data-source-registry';
import { PersistenceRegistry, memoryStore } from './persistence-registry';
import { LayoutRegistry } from './layout-registry';
import { SchemaTransformerRegistry, jsonSchemaToZod, openApiToTools } from './schema-transformer-registry';
import { agenticDataSource } from '../factories/agentic-data-source';

describe('DataSourceRegistry', () => {
  it('registers a source and looks it up by kind', () => {
    TestBed.configureTestingModule({});
    const registry = TestBed.inject(DataSourceRegistry);
    registry.register(agenticDataSource({ name: 'flights', kind: 'rest', adapter: () => Promise.resolve([]) }));
    registry.register(agenticDataSource({ name: 'events',  kind: 'sse',  adapter: () => Promise.resolve([]) }));
    expect(registry.byKind('rest').map((d) => d.name)).toEqual(['flights']);
    expect(registry.byKind('sse').map((d) => d.name)).toEqual(['events']);
  });
});

describe('PersistenceRegistry', () => {
  let registry: PersistenceRegistry;
  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(PersistenceRegistry);
  });

  it('ships memory adapter by default', () => {
    expect(registry.get('memory')).toBeDefined();
  });

  it('memory store round-trips values', async () => {
    const store = registry.get('memory')!;
    await store.write('key', { foo: 'bar' });
    expect(await store.read('key')).toEqual({ foo: 'bar' });
    await store.remove('key');
    expect(await store.read('key')).toBeUndefined();
  });

  it('custom store registration replaces by name', async () => {
    const custom = memoryStore('memory'); // same name as default
    registry.register(custom);
    expect(registry.get('memory')).toBe(custom);
  });
});

describe('LayoutRegistry', () => {
  it('starts empty (no built-in layouts)', () => {
    TestBed.configureTestingModule({});
    const registry = TestBed.inject(LayoutRegistry);
    expect(registry.list()).toEqual([]);
  });
});

describe('SchemaTransformerRegistry', () => {
  it('ships zod↔json-schema transformers by default', () => {
    TestBed.configureTestingModule({});
    const registry = TestBed.inject(SchemaTransformerRegistry);
    expect(registry.find('zod', 'json-schema')).toBeDefined();
    expect(registry.find('json-schema', 'zod')).toBeDefined();
  });

  it('jsonSchemaToZod converts primitive shapes', () => {
    expect(jsonSchemaToZod({ type: 'string' }).safeParse('hello').success).toBe(true);
    expect(jsonSchemaToZod({ type: 'number' }).safeParse(42).success).toBe(true);
    expect(jsonSchemaToZod({ type: 'boolean' }).safeParse(true).success).toBe(true);
    const obj = jsonSchemaToZod({ type: 'object', properties: { name: { type: 'string' } }, required: ['name'] });
    expect(obj.safeParse({ name: 'a' }).success).toBe(true);
    expect(obj.safeParse({}).success).toBe(false);
  });

  it('openApiToTools imports operations as ToolDefs', () => {
    const spec = {
      paths: {
        '/flights': {
          get: {
            operationId: 'listFlights',
            summary: 'List flights',
          },
          post: {
            operationId: 'bookFlight',
            summary: 'Book a flight',
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
                },
              },
            },
          },
        },
      },
    };
    const tools = openApiToTools(spec);
    expect(tools.map((t) => t.name).sort()).toEqual(['bookFlight', 'listFlights']);
    const book = tools.find((t) => t.name === 'bookFlight')!;
    expect(book.schema.safeParse({ from: 'LAX', to: 'JFK' }).success).toBe(true);
    expect(book.schema.safeParse({ from: 'LAX' }).success).toBe(false);
  });
});

describe('Schema interop with z.object directly', () => {
  it('z schemas survive a round-trip through transformers', () => {
    TestBed.configureTestingModule({});
    const registry = TestBed.inject(SchemaTransformerRegistry);
    const zod = z.object({ a: z.string(), b: z.number() });
    const json = registry.find('zod', 'json-schema')!.transform(zod) as Record<string, unknown>;
    expect(json['type']).toBe('object');
    const back = registry.find('json-schema', 'zod')!.transform(json) as ReturnType<typeof z.object>;
    expect(back.safeParse({ a: 'x', b: 1 }).success).toBe(true);
  });
});
