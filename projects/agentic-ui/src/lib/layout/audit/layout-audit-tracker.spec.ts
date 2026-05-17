import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LayoutResolver } from '../resolver';
import {
  LAYOUT_INPUT,
  type LayoutInput,
  type LayoutInputSource,
  type LayoutRule,
} from '../resolver/types';
import type { SlotDef } from '../types';
import { LayoutAuditTracker } from './layout-audit-tracker';
import {
  LAYOUT_AUDIT_ATTRIBUTION,
  LAYOUT_AUDIT_SINK,
  type LayoutAuditSink,
} from './types';

const slot = (component: string): SlotDef => ({ component });

function makeInput(
  id: string,
  source: LayoutInputSource,
  rulesSignal: WritableSignal<readonly LayoutRule[]>,
): { provide: typeof LAYOUT_INPUT; useValue: LayoutInput; multi: true } {
  return {
    provide: LAYOUT_INPUT,
    useValue: { id, source, evaluate: () => rulesSignal() },
    multi: true,
  };
}

describe('LayoutAuditTracker', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('emits a LAYOUT_APPLIED event when the resolved slots change', () => {
    const rules = signal<readonly LayoutRule[]>([]);
    TestBed.configureTestingModule({
      providers: [makeInput('test', 'route', rules)],
    });
    const tracker = TestBed.inject(LayoutAuditTracker);
    TestBed.inject(LayoutResolver);
    TestBed.flushEffects();
    expect(tracker.chain()).toHaveLength(1); // empty layout is its own first event

    rules.set([{ id: 'r', source: 'route', slots: { primary: slot('docPreview') }, reason: 'route /docs' }]);
    TestBed.flushEffects();

    expect(tracker.chain()).toHaveLength(2);
    const last = tracker.chain()[1];
    expect(last.kind).toBe('LAYOUT_APPLIED');
    expect(last.slots).toEqual({ primary: { component: 'docPreview' } });
    expect(last.appliedRules[0].source).toBe('route');
  });

  it('chains prevHash → chainHash across events', () => {
    const rules = signal<readonly LayoutRule[]>([]);
    TestBed.configureTestingModule({
      providers: [makeInput('test', 'route', rules)],
    });
    const tracker = TestBed.inject(LayoutAuditTracker);
    TestBed.inject(LayoutResolver);
    TestBed.flushEffects();
    rules.set([{ id: 'a', source: 'route', slots: { primary: slot('a') }, reason: 'a' }]);
    TestBed.flushEffects();
    rules.set([{ id: 'b', source: 'route', slots: { primary: slot('b') }, reason: 'b' }]);
    TestBed.flushEffects();

    const chain = tracker.chain();
    expect(chain).toHaveLength(3);
    expect(chain[0].prevHash).toBeNull();
    expect(chain[1].prevHash).toBe(chain[0].chainHash);
    expect(chain[2].prevHash).toBe(chain[1].chainHash);
  });

  it('validateChain returns null on a valid chain', () => {
    const rules = signal<readonly LayoutRule[]>([
      { id: 'a', source: 'route', slots: { primary: slot('a') }, reason: 'a' },
    ]);
    TestBed.configureTestingModule({
      providers: [makeInput('test', 'route', rules)],
    });
    const tracker = TestBed.inject(LayoutAuditTracker);
    TestBed.inject(LayoutResolver);
    TestBed.flushEffects();
    rules.set([{ id: 'b', source: 'route', slots: { primary: slot('b') }, reason: 'b' }]);
    TestBed.flushEffects();
    expect(tracker.validateChain()).toBeNull();
  });

  it('does NOT emit when the resolved slots are unchanged', () => {
    const rules = signal<readonly LayoutRule[]>([
      { id: 'a', source: 'route', slots: { primary: slot('a') }, reason: 'a' },
    ]);
    TestBed.configureTestingModule({
      providers: [makeInput('test', 'route', rules)],
    });
    const tracker = TestBed.inject(LayoutAuditTracker);
    TestBed.inject(LayoutResolver);
    TestBed.flushEffects();
    expect(tracker.chain()).toHaveLength(1);
    // Force the rules signal to change but produce identical output.
    rules.set([{ id: 'a', source: 'route', slots: { primary: slot('a') }, reason: 'a' }]);
    TestBed.flushEffects();
    expect(tracker.chain()).toHaveLength(1);
  });

  it('calls the external sink on every emission when wired', () => {
    const sink: LayoutAuditSink = { emit: vi.fn() };
    const rules = signal<readonly LayoutRule[]>([
      { id: 'a', source: 'route', slots: { primary: slot('a') }, reason: 'a' },
    ]);
    TestBed.configureTestingModule({
      providers: [
        makeInput('test', 'route', rules),
        { provide: LAYOUT_AUDIT_SINK, useValue: sink },
      ],
    });
    TestBed.inject(LayoutAuditTracker);
    TestBed.inject(LayoutResolver);
    TestBed.flushEffects();
    expect(sink.emit).toHaveBeenCalledTimes(1);
  });

  it('includes attribution metadata when provider is configured', () => {
    const rules = signal<readonly LayoutRule[]>([
      { id: 'a', source: 'route', slots: { primary: slot('a') }, reason: 'a' },
    ]);
    TestBed.configureTestingModule({
      providers: [
        makeInput('test', 'route', rules),
        { provide: LAYOUT_AUDIT_ATTRIBUTION, useValue: () => ({ userId: 'u1', matterId: 'm1' }) },
      ],
    });
    const tracker = TestBed.inject(LayoutAuditTracker);
    TestBed.inject(LayoutResolver);
    TestBed.flushEffects();
    const last = tracker.chain()[0];
    expect(last.attribution).toEqual({ userId: 'u1', matterId: 'm1' });
  });

  it('snapshotAt returns null for a timestamp before the chain starts', () => {
    const rules = signal<readonly LayoutRule[]>([
      { id: 'a', source: 'route', slots: { primary: slot('a') }, reason: 'a' },
    ]);
    TestBed.configureTestingModule({
      providers: [makeInput('test', 'route', rules)],
    });
    const tracker = TestBed.inject(LayoutAuditTracker);
    TestBed.inject(LayoutResolver);
    TestBed.flushEffects();
    expect(tracker.chain()).toHaveLength(1);
    // 1970 is unambiguously before chain[0].
    expect(tracker.snapshotAt('1970-01-01T00:00:00.000Z')).toBeNull();
    // The chain's own timestamp resolves to its own event (most-recent-at-or-before).
    const ts = tracker.chain()[0].timestamp;
    expect(tracker.snapshotAt(ts)?.id).toBe(tracker.chain()[0].id);
  });

  it('reset clears the chain + prevHash', () => {
    const rules = signal<readonly LayoutRule[]>([
      { id: 'a', source: 'route', slots: { primary: slot('a') }, reason: 'a' },
    ]);
    TestBed.configureTestingModule({
      providers: [makeInput('test', 'route', rules)],
    });
    const tracker = TestBed.inject(LayoutAuditTracker);
    TestBed.inject(LayoutResolver);
    TestBed.flushEffects();
    expect(tracker.chain()).toHaveLength(1);
    tracker.reset();
    expect(tracker.chain()).toEqual([]);
  });
});
