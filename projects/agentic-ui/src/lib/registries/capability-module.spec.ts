import { TestBed } from '@angular/core/testing';
import { EnvironmentInjector } from '@angular/core';
import { describe, expect, it, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  agenticTool,
  agenticWidget,
  CapabilityRegistry,
  ComponentRegistry,
  DashboardRegistry,
  PlaybookRegistry,
  ToolRegistry,
  TriggerRegistry,
  type DashboardDef,
  type PlaybookDef,
  type ToolDef,
  type TriggerDef,
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

// ── triggers / dashboards / playbooks (post-chat-surfaces P2/P3/P5) ─

describe('defineCapabilityModule + apply() — federation for triggers / dashboards / playbooks', () => {
  let injector: EnvironmentInjector;
  let triggers: TriggerRegistry;
  let dashboards: DashboardRegistry;
  let playbooks: PlaybookRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    injector = TestBed.inject(EnvironmentInjector);
    triggers = TestBed.inject(TriggerRegistry);
    dashboards = TestBed.inject(DashboardRegistry);
    playbooks = TestBed.inject(PlaybookRegistry);
  });

  function sampleTrigger(name: string): TriggerDef {
    return {
      name,
      description: 'sample',
      kind: 'cron',
      spec: { kind: 'cron', expression: '@daily' },
      target: { kind: 'tool', tool: 'noop', args: {} },
    };
  }

  function sampleDashboard(name: string): DashboardDef {
    return {
      name,
      title: `Dashboard ${name}`,
      layout: 'simple',
      tiles: [],
    };
  }

  function samplePlaybook(name: string): PlaybookDef {
    return {
      name,
      title: `Playbook ${name}`,
      steps: [],
    };
  }

  it('manifest.exposes lists trigger / dashboard / playbook names when contributed', () => {
    const cap = defineCapabilityModule({
      remoteName: 'production',
      version: '1.0.0',
      triggers: [sampleTrigger('hourly-tile-refresh')],
      dashboards: [sampleDashboard('production-throughput')],
      playbooks: [samplePlaybook('pre-production-qc')],
    });
    expect(cap.manifest.exposes.triggers).toEqual(['hourly-tile-refresh']);
    expect(cap.manifest.exposes.dashboards).toEqual(['production-throughput']);
    expect(cap.manifest.exposes.playbooks).toEqual(['pre-production-qc']);
  });

  it('manifest.exposes omits the keys when nothing is contributed', () => {
    const cap = defineCapabilityModule({
      remoteName: 'bookings',
      version: '1.0.0',
    });
    expect(cap.manifest.exposes.triggers).toBeUndefined();
    expect(cap.manifest.exposes.dashboards).toBeUndefined();
    expect(cap.manifest.exposes.playbooks).toBeUndefined();
  });

  it('stamps source="remote:<name>" on every contributed entry across all three registries', () => {
    const cap = defineCapabilityModule({
      remoteName: 'production',
      version: '1.0.0',
      triggers: [sampleTrigger('t1')],
      dashboards: [sampleDashboard('d1')],
      playbooks: [samplePlaybook('p1')],
    });
    expect(cap.triggers[0]?.source).toBe('remote:production');
    expect(cap.dashboards[0]?.source).toBe('remote:production');
    expect(cap.playbooks[0]?.source).toBe('remote:production');
  });

  it('apply() registers entries in all three new registries via the injector', () => {
    const cap = defineCapabilityModule({
      remoteName: 'production',
      version: '1.0.0',
      triggers: [sampleTrigger('t1')],
      dashboards: [sampleDashboard('d1')],
      playbooks: [samplePlaybook('p1')],
    });
    cap.apply(injector);

    expect(triggers.list().map((t) => t.name)).toEqual(['t1']);
    expect(dashboards.list().map((d) => d.name)).toEqual(['d1']);
    expect(playbooks.list().map((p) => p.name)).toEqual(['p1']);
  });

  it('disposer reaps every entry across triggers / dashboards / playbooks symmetrically', () => {
    const cap = defineCapabilityModule({
      remoteName: 'production',
      version: '1.0.0',
      triggers: [sampleTrigger('t1'), sampleTrigger('t2')],
      dashboards: [sampleDashboard('d1')],
      playbooks: [samplePlaybook('p1'), samplePlaybook('p2')],
    });
    const dispose = cap.apply(injector);

    expect(triggers.list()).toHaveLength(2);
    expect(dashboards.list()).toHaveLength(1);
    expect(playbooks.list()).toHaveLength(2);

    dispose();

    expect(triggers.list()).toEqual([]);
    expect(dashboards.list()).toEqual([]);
    expect(playbooks.list()).toEqual([]);
  });

  it('host-registered entries survive when a remote contributing those kinds unloads', () => {
    // Host adds a trigger directly (not via a capability module).
    triggers.register(sampleTrigger('host-cron'));
    // Remote contributes its own.
    const cap = defineCapabilityModule({
      remoteName: 'production',
      version: '1.0.0',
      triggers: [sampleTrigger('remote-cron')],
    });
    const dispose = cap.apply(injector);
    expect(triggers.list().map((t) => t.name).sort()).toEqual(['host-cron', 'remote-cron']);
    dispose();
    expect(triggers.list().map((t) => t.name)).toEqual(['host-cron']);
  });

  it('apply() with explicit CapabilityRegistries (non-shared lib path) writes to the supplied registries', () => {
    const cap = defineCapabilityModule({
      remoteName: 'review',
      version: '1.0.0',
      triggers: [sampleTrigger('review-cron')],
      dashboards: [sampleDashboard('reviewer-productivity')],
      playbooks: [samplePlaybook('weekly-qc')],
    });
    cap.apply({
      tools: TestBed.inject(ToolRegistry),
      components: TestBed.inject(ComponentRegistry),
      capabilities: TestBed.inject(CapabilityRegistry),
      triggers,
      dashboards,
      playbooks,
    });
    expect(triggers.list().map((t) => t.name)).toEqual(['review-cron']);
    expect(dashboards.list().map((d) => d.name)).toEqual(['reviewer-productivity']);
    expect(playbooks.list().map((p) => p.name)).toEqual(['weekly-qc']);
  });

  it('apply() does NOT touch trigger/dashboard/playbook registries when nothing of that kind is contributed', () => {
    // Pre-populate the host's registries; the apply call shouldn't
    // disturb them.
    triggers.register(sampleTrigger('pre-existing'));
    dashboards.register(sampleDashboard('pre-existing'));
    playbooks.register(samplePlaybook('pre-existing'));

    const cap = defineCapabilityModule({
      remoteName: 'tools-only',
      version: '1.0.0',
      tools: [
        agenticTool({
          name: 't1',
          description: '',
          schema: z.object({}),
          handler: async () => undefined,
        }) as ToolDef,
      ],
    });
    const dispose = cap.apply(injector);

    // The pre-existing entries are still there + remote's tool registered.
    expect(triggers.list().map((t) => t.name)).toEqual(['pre-existing']);
    expect(dashboards.list().map((d) => d.name)).toEqual(['pre-existing']);
    expect(playbooks.list().map((p) => p.name)).toEqual(['pre-existing']);

    dispose();

    // Pre-existing still there after dispose — removeBySource scoped
    // by 'remote:tools-only' didn't touch the host-sourced entries.
    expect(triggers.list().map((t) => t.name)).toEqual(['pre-existing']);
    expect(dashboards.list().map((d) => d.name)).toEqual(['pre-existing']);
    expect(playbooks.list().map((p) => p.name)).toEqual(['pre-existing']);
  });
});
