import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { PromptRegistry } from './prompt-registry';
import { SkillRegistry } from './skill-registry';
import { KnowledgeRegistry } from './knowledge-registry';
import { MemoryRegistry } from './memory-registry';
import { WorkflowRegistry } from './workflow-registry';
import { NavigationRegistry } from './navigation-registry';
import type {
  KnowledgeDef,
  MemoryDef,
  NavigationDef,
  PromptDef,
  SkillDef,
  WorkflowCapabilityDef,
} from '../types/registry-defs';

describe('AEP Seam B registries', () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  it('PromptRegistry registers, lists, and disposes', () => {
    const reg = TestBed.inject(PromptRegistry);
    const def: PromptDef = { name: 'intakeGreeting', template: 'Hello {{name}}', variables: ['name'] };
    const dispose = reg.register(def);
    expect(reg.get('intakeGreeting')?.template).toBe('Hello {{name}}');
    dispose();
    expect(reg.list()).toEqual([]);
  });

  it('SkillRegistry stores tools + prompt bundle', () => {
    const reg = TestBed.inject(SkillRegistry);
    const def: SkillDef = { name: 'conflictReview', description: 'Review conflicts', tools: ['conflictCheck', 'aiSummary'], prompt: 'intakeGreeting' };
    reg.register(def);
    expect(reg.get('conflictReview')?.tools).toEqual(['conflictCheck', 'aiSummary']);
  });

  it('KnowledgeRegistry.byKind filters', () => {
    const reg = TestBed.inject(KnowledgeRegistry);
    const a: KnowledgeDef = { name: 'matters', kind: 'vector', connector: 'pg' };
    const b: KnowledgeDef = { name: 'policies', kind: 'document' };
    reg.register(a);
    reg.register(b);
    expect(reg.byKind('vector').map((k) => k.name)).toEqual(['matters']);
  });

  it('MemoryRegistry.byKind filters', () => {
    const reg = TestBed.inject(MemoryRegistry);
    const m: MemoryDef = { name: 'userPrefs', kind: 'long-term', scope: 'user', provider: 'redis' };
    reg.register(m);
    expect(reg.byKind('long-term').map((x) => x.name)).toEqual(['userPrefs']);
    expect(reg.byKind('episodic')).toEqual([]);
  });

  it('WorkflowRegistry wraps a WorkflowDef', () => {
    const reg = TestBed.inject(WorkflowRegistry);
    const def: WorkflowCapabilityDef = {
      name: 'onboard',
      workflow: { steps: [{ id: 's1', widget: 'w1', next: null }], onComplete: async () => undefined },
    };
    reg.register(def);
    expect(reg.get('onboard')?.workflow.steps).toHaveLength(1);
  });

  it('NavigationRegistry orders and nests entries', () => {
    const reg = TestBed.inject(NavigationRegistry);
    const items: NavigationDef[] = [
      { name: 'dash', title: 'Dashboard', route: '/', order: 1 },
      { name: 'docs', title: 'Documents', route: '/docs', order: 2 },
      { name: 'docsSearch', title: 'Search', route: '/docs/search', parent: 'docs', order: 1 },
      { name: 'zLast', title: 'Zed', route: '/z' }, // no order → sorts last
    ];
    items.forEach((i) => reg.register(i));

    expect(reg.roots().map((n) => n.name)).toEqual(['dash', 'docs', 'zLast']);
    expect(reg.childrenOf('docs').map((n) => n.name)).toEqual(['docsSearch']);
    expect(reg.ordered()[0].name).toBe('dash');
  });

  it('federation teardown removes entries by source across the new registries', () => {
    const nav = TestBed.inject(NavigationRegistry);
    nav.register({ name: 'remoteNav', title: 'Remote', route: '/r', source: 'remote:bookings' });
    nav.register({ name: 'hostNav', title: 'Host', route: '/h' });
    nav.removeBySource('remote:bookings');
    expect(nav.list().map((n) => n.name)).toEqual(['hostNav']);
  });
});
