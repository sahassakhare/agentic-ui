import { Injectable, signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import type { SlotDef } from '../types';
import { LayoutResolver } from './layout-resolver';
import {
  LAYOUT_INPUT,
  LAYOUT_WEIGHTS,
  type LayoutInput,
  type LayoutInputSource,
  type LayoutRule,
} from './types';

/**
 * Tiny helper to build a one-shot rule + return it via a controllable
 * signal. Each test wires a few of these to the resolver to verify
 * precedence / merge / eviction behaviour without depending on the
 * built-in inputs (which require Router / persona / agent-store DI).
 */
function makeInput(
  id: string,
  source: LayoutInputSource,
  rulesSignal: WritableSignal<readonly LayoutRule[]>,
): { provide: typeof LAYOUT_INPUT; useValue: LayoutInput; multi: true } {
  const input: LayoutInput = {
    id,
    source,
    evaluate: () => rulesSignal(),
  };
  return { provide: LAYOUT_INPUT, useValue: input, multi: true };
}

const slot = (component: string): SlotDef => ({ component });

describe('LayoutResolver', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('returns an empty layout when no inputs are registered', () => {
    TestBed.configureTestingModule({});
    const resolver = TestBed.inject(LayoutResolver);
    expect(resolver.active().slots).toEqual({});
    expect(resolver.active().appliedRules).toEqual([]);
  });

  it('merges slot-level contributions across multiple inputs', () => {
    const routeRules = signal<readonly LayoutRule[]>([
      { id: 'r', source: 'route', slots: { primary: slot('docPreview') }, reason: 'route /documents' },
    ]);
    const personaRules = signal<readonly LayoutRule[]>([
      { id: 'p', source: 'persona', slots: { sidebar: slot('tagPanel') }, reason: 'persona lead-counsel' },
    ]);
    TestBed.configureTestingModule({
      providers: [
        makeInput('route-test', 'route', routeRules),
        makeInput('persona-test', 'persona', personaRules),
      ],
    });
    const resolver = TestBed.inject(LayoutResolver);
    const result = resolver.active();
    expect(result.slots).toEqual({
      primary: { component: 'docPreview' },
      sidebar: { component: 'tagPanel' },
    });
    expect(result.appliedRules.map((r) => r.source).sort()).toEqual(['persona', 'route']);
  });

  it('higher precedence wins on slot-level conflict (agent > persona)', () => {
    const personaRules = signal<readonly LayoutRule[]>([
      { id: 'p', source: 'persona', slots: { primary: slot('personaTile') }, reason: 'persona default' },
    ]);
    const agentRules = signal<readonly LayoutRule[]>([
      { id: 'a', source: 'agent', slots: { primary: slot('agentTile') }, reason: 'agent emitted' },
    ]);
    TestBed.configureTestingModule({
      providers: [
        makeInput('persona-test', 'persona', personaRules),
        makeInput('agent-test', 'agent', agentRules),
      ],
    });
    const resolver = TestBed.inject(LayoutResolver);
    const result = resolver.active();
    expect(result.slots['primary']).toEqual({ component: 'agentTile' });
    // appliedRules only contains the winning entry per slot
    expect(result.appliedRules).toHaveLength(1);
    expect(result.appliedRules[0].source).toBe('agent');
  });

  it('weights override changes the precedence outcome', () => {
    const personaRules = signal<readonly LayoutRule[]>([
      { id: 'p', source: 'persona', slots: { primary: slot('personaTile') }, reason: 'persona' },
    ]);
    const agentRules = signal<readonly LayoutRule[]>([
      { id: 'a', source: 'agent', slots: { primary: slot('agentTile') }, reason: 'agent' },
    ]);
    TestBed.configureTestingModule({
      providers: [
        makeInput('persona-test', 'persona', personaRules),
        makeInput('agent-test', 'agent', agentRules),
        // Flip the precedence: persona now beats agent.
        { provide: LAYOUT_WEIGHTS, useValue: { persona: 9999, agent: 1 } },
      ],
    });
    const resolver = TestBed.inject(LayoutResolver);
    expect(resolver.active().slots['primary']).toEqual({ component: 'personaTile' });
  });

  it('eviction drops a slot even if a lower-weight rule provides it', () => {
    const personaRules = signal<readonly LayoutRule[]>([
      { id: 'p', source: 'persona', slots: { primary: slot('personaTile'), footer: slot('footerTile') }, reason: 'persona' },
    ]);
    const agentRules = signal<readonly LayoutRule[]>([
      { id: 'a', source: 'agent', slots: { primary: slot('agentTile') }, evictSlots: ['footer'], reason: 'agent' },
    ]);
    TestBed.configureTestingModule({
      providers: [
        makeInput('persona-test', 'persona', personaRules),
        makeInput('agent-test', 'agent', agentRules),
      ],
    });
    const resolver = TestBed.inject(LayoutResolver);
    const result = resolver.active();
    // primary wins from agent; footer evicted entirely.
    expect(result.slots).toEqual({ primary: { component: 'agentTile' } });
    expect(result.slots['footer']).toBeUndefined();
  });

  it('skips rules whose matches() predicate returns false', () => {
    let active = false;
    const rules = signal<readonly LayoutRule[]>([
      {
        id: 'gated',
        source: 'route',
        slots: { primary: slot('gatedTile') },
        reason: 'route + condition',
        matches: () => active,
      },
    ]);
    TestBed.configureTestingModule({
      providers: [makeInput('gated-test', 'route', rules)],
    });
    const resolver = TestBed.inject(LayoutResolver);
    expect(resolver.active().slots).toEqual({});
    active = true;
    // Predicate flip is not a signal change — the resolver still uses
    // its cached `active()` because no signal it tracks invalidated.
    // Force recompute by changing the rules array reference.
    rules.set([...rules()]);
    expect(resolver.active().slots).toEqual({ primary: { component: 'gatedTile' } });
  });

  it('within the same source, higher priority wins', () => {
    const rules = signal<readonly LayoutRule[]>([
      { id: 'low', source: 'route', priority: 0, slots: { primary: slot('low') }, reason: 'low priority route' },
      { id: 'high', source: 'route', priority: 10, slots: { primary: slot('high') }, reason: 'high priority route' },
    ]);
    TestBed.configureTestingModule({
      providers: [makeInput('route-test', 'route', rules)],
    });
    const resolver = TestBed.inject(LayoutResolver);
    expect(resolver.active().slots['primary']).toEqual({ component: 'high' });
  });

  it('reactivity — changing an input signal recomputes active', () => {
    const rules = signal<readonly LayoutRule[]>([]);
    TestBed.configureTestingModule({
      providers: [makeInput('reactive-test', 'route', rules)],
    });
    const resolver = TestBed.inject(LayoutResolver);
    expect(resolver.active().slots).toEqual({});
    rules.set([{ id: 'r', source: 'route', slots: { primary: slot('newTile') }, reason: 'now' }]);
    expect(resolver.active().slots).toEqual({ primary: { component: 'newTile' } });
  });

  it('weightFor returns the effective weight per source', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: LAYOUT_WEIGHTS, useValue: { persona: 500 } }],
    });
    const resolver = TestBed.inject(LayoutResolver);
    expect(resolver.weightFor('persona')).toBe(500);   // overridden
    expect(resolver.weightFor('agent')).toBe(1000);    // default
    expect(resolver.weightFor('hardcoded')).toBe(0);
  });
});

// ── Smoke test for the route input + provideLayoutResolver helper ──────────

import { Router } from '@angular/router';
import { Subject } from 'rxjs';
import { NavigationEnd } from '@angular/router';
import { provideLayoutResolver } from './provide-layout-resolver';
import { RouteLayoutInput } from './inputs';

@Injectable()
class FakeRouter {
  readonly events = new Subject<NavigationEnd>();
  url = '/';
  navigate(url: string) {
    this.url = url;
    this.events.next(new NavigationEnd(0, url, url));
  }
}

describe('RouteLayoutInput + provideLayoutResolver', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('fires the matching route rule + replaces with new rule on navigation', () => {
    const fakeRouter = new FakeRouter();
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: fakeRouter },
        provideLayoutResolver({
          routeRules: [
            { pattern: '/documents/*', slots: { primary: slot('docPreview') } },
            { pattern: '/holds', slots: { primary: slot('holdsCanvas') } },
          ],
        }),
      ],
    });
    const resolver = TestBed.inject(LayoutResolver);
    // Pre-warm RouteLayoutInput so its toSignal subscription is active
    // before we trigger router events.
    TestBed.inject(RouteLayoutInput);
    fakeRouter.navigate('/documents/471');
    expect(resolver.active().slots['primary']).toEqual({ component: 'docPreview' });
    fakeRouter.navigate('/holds');
    expect(resolver.active().slots['primary']).toEqual({ component: 'holdsCanvas' });
    fakeRouter.navigate('/unmatched');
    expect(resolver.active().slots).toEqual({});
  });
});
