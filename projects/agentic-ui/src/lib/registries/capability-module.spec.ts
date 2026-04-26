import { TestBed } from '@angular/core/testing';
import { EnvironmentInjector } from '@angular/core';
import { describe, expect, it, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  agenticTool,
  agenticWidget,
  CapabilityRegistry,
  ComponentRegistry,
  ToolRegistry,
  type ToolDef,
} from '../internal';
import { defineCapabilityModule } from '../mfe/capability-module';

describe('defineCapabilityModule + apply()', () => {
  let injector: EnvironmentInjector;
  let tools: ToolRegistry;
  let components: ComponentRegistry;
  let capabilities: CapabilityRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    injector = TestBed.inject(EnvironmentInjector);
    tools = TestBed.inject(ToolRegistry);
    components = TestBed.inject(ComponentRegistry);
    capabilities = TestBed.inject(CapabilityRegistry);
  });

  it('stamps source="remote:<name>" on every tool and component', () => {
    const tool = agenticTool({
      name: 'bookFlight',
      description: 'Books a flight',
      schema: z.object({}),
      handler: async () => ({}),
    }) as ToolDef;
    const widget = agenticWidget({
      name: 'flightCard',
      component: class {} as never,
      propsSchema: z.object({}),
    });

    const cap = defineCapabilityModule({
      remoteName: 'bookings',
      version: '1.0.0',
      tools: [tool],
      components: [widget],
    });

    expect(cap.tools[0]?.source).toBe('remote:bookings');
    expect(cap.components[0]?.source).toBe('remote:bookings');
    expect(cap.manifest.exposes.tools).toEqual(['bookFlight']);
    expect(cap.manifest.exposes.components).toEqual(['flightCard']);
  });

  it('apply() registers entries; disposer removes them and cleans the CapabilityRegistry', () => {
    const cap = defineCapabilityModule({
      remoteName: 'bookings',
      version: '1.0.0',
      tools: [
        agenticTool({ name: 'bookFlight', description: '', schema: z.object({}), handler: async () => undefined }) as ToolDef,
      ],
      components: [
        agenticWidget({ name: 'flightCard', component: class {} as never, propsSchema: z.object({}) }),
      ],
    });

    const dispose = cap.apply(injector);

    expect(tools.list().map((t) => t.name)).toEqual(['bookFlight']);
    expect(components.list().map((c) => c.name)).toEqual(['flightCard']);
    expect(capabilities.byRemote('bookings')).toBeDefined();
    expect(capabilities.forTool('bookFlight')).toBe('bookings');
    expect(capabilities.forComponent('flightCard')).toBe('bookings');

    dispose();
    expect(tools.list()).toEqual([]);
    expect(components.list()).toEqual([]);
    expect(capabilities.list()).toEqual([]);
  });

  it('removeBySource leaves host-sourced entries intact when a remote unloads', () => {
    tools.register(agenticTool({
      name: 'hostTool', description: '', schema: z.object({}), handler: async () => undefined,
    }) as ToolDef);

    const cap = defineCapabilityModule({
      remoteName: 'bookings',
      version: '1.0.0',
      tools: [agenticTool({ name: 'remoteTool', description: '', schema: z.object({}), handler: async () => undefined }) as ToolDef],
    });
    const dispose = cap.apply(injector);
    expect(tools.list().map((t) => t.name).sort()).toEqual(['hostTool', 'remoteTool']);
    dispose();
    expect(tools.list().map((t) => t.name)).toEqual(['hostTool']);
  });
});
