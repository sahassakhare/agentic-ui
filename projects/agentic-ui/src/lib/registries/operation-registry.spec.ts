import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';

import {
  AGENTIC_OPERATION_AUDIT_HOOK,
  OperationRegistry,
  type OperationAuditEvent,
} from './operation-registry';

describe('OperationRegistry (Capability F5)', () => {
  let registry: OperationRegistry;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    registry = TestBed.inject(OperationRegistry);
    registry.clear();
  });

  describe('start / reportProgress / complete / fail', () => {
    it('start mints an opId and records a started operation', () => {
      const opId = registry.start({
        toolName: 'runTAR',
        description: 'TAR classification',
        estDurationMs: 60000,
      });
      expect(opId).toMatch(/^op-/);
      const op = registry.get(opId)!;
      expect(op).toMatchObject({
        opId,
        toolName: 'runTAR',
        description: 'TAR classification',
        status: 'started',
        estDurationMs: 60000,
      });
      expect(op.startedAt).toBeDefined();
    });

    it('reportProgress transitions to status=progress, clamps pct, preserves phase', () => {
      const opId = registry.start({ toolName: 'runTAR', description: 'TAR' });
      registry.reportProgress(opId, { pct: 25, phase: 'scoring batch 5/20' });
      let op = registry.get(opId)!;
      expect(op.status).toBe('progress');
      expect(op.pct).toBe(25);
      expect(op.phase).toBe('scoring batch 5/20');

      // Phase preserved across an update without phase
      registry.reportProgress(opId, { pct: 50 });
      op = registry.get(opId)!;
      expect(op.pct).toBe(50);
      expect(op.phase).toBe('scoring batch 5/20');

      // Pct clamped to [0, 100]
      registry.reportProgress(opId, { pct: 150 });
      expect(registry.get(opId)!.pct).toBe(100);
      registry.reportProgress(opId, { pct: -5 });
      expect(registry.get(opId)!.pct).toBe(0);
    });

    it('complete sets status=finished, pct=100, captures result + durationMs', async () => {
      const opId = registry.start({ toolName: 'runTAR', description: 'TAR' });
      // Tiny delay so durationMs is non-zero on most clocks.
      await new Promise((r) => setTimeout(r, 5));
      registry.complete(opId, { scored: 50000 });
      const op = registry.get(opId)!;
      expect(op.status).toBe('finished');
      expect(op.pct).toBe(100);
      expect(op.result).toEqual({ scored: 50000 });
      expect(op.finishedAt).toBeDefined();
      expect(op.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('fail sets status=failed and captures error', () => {
      const opId = registry.start({ toolName: 'runTAR', description: 'TAR' });
      registry.fail(opId, { code: 'OUT_OF_QUOTA', message: 'monthly cap reached' });
      const op = registry.get(opId)!;
      expect(op.status).toBe('failed');
      expect(op.error).toEqual({ code: 'OUT_OF_QUOTA', message: 'monthly cap reached' });
      expect(op.finishedAt).toBeDefined();
    });

    it('terminal ops are immutable: subsequent reportProgress / complete / fail are no-ops', () => {
      const opId = registry.start({ toolName: 'runTAR', description: 'TAR' });
      registry.complete(opId, 'first');
      registry.reportProgress(opId, { pct: 10 });
      registry.complete(opId, 'second');
      registry.fail(opId, { code: 'X', message: 'x' });
      const op = registry.get(opId)!;
      expect(op.status).toBe('finished');
      expect(op.result).toBe('first');
    });

    it('reportProgress / complete / fail on unknown opId is a silent no-op (no throw)', () => {
      expect(() => registry.reportProgress('nope', { pct: 50 })).not.toThrow();
      expect(() => registry.complete('nope', 'x')).not.toThrow();
      expect(() => registry.fail('nope', { code: 'A', message: 'b' })).not.toThrow();
    });
  });

  describe('queries', () => {
    it('byStatus filters by lifecycle state', () => {
      const a = registry.start({ toolName: 'a', description: 'a' });
      const b = registry.start({ toolName: 'b', description: 'b' });
      const c = registry.start({ toolName: 'c', description: 'c' });
      registry.reportProgress(b, { pct: 50 });
      registry.complete(c, 'done');

      expect(registry.byStatus('started').map((o) => o.opId)).toEqual([a]);
      expect(registry.byStatus('progress').map((o) => o.opId)).toEqual([b]);
      expect(registry.byStatus('finished').map((o) => o.opId)).toEqual([c]);
    });

    it('active() returns started + progress operations', () => {
      const a = registry.start({ toolName: 'a', description: 'a' });
      const b = registry.start({ toolName: 'b', description: 'b' });
      const c = registry.start({ toolName: 'c', description: 'c' });
      registry.reportProgress(b, { pct: 50 });
      registry.complete(c, 'done');

      expect(registry.active().map((o) => o.opId).sort()).toEqual([a, b].sort());
    });

    it('operations are sorted by startedAt asc', async () => {
      const a = registry.start({ toolName: 'a', description: 'a' });
      await new Promise((r) => setTimeout(r, 2));
      const b = registry.start({ toolName: 'b', description: 'b' });
      expect(registry.operations().map((o) => o.opId)).toEqual([a, b]);
    });
  });

});

describe('OperationRegistry — AGENTIC_OPERATION_AUDIT_HOOK', () => {
  it('fires for every transition (started, progress, finished, failed)', () => {
    const events: OperationAuditEvent[] = [];
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: AGENTIC_OPERATION_AUDIT_HOOK, useValue: (e: OperationAuditEvent) => events.push(e) },
      ],
    });
    const reg = TestBed.inject(OperationRegistry);
    reg.clear();

    const opId = reg.start({ toolName: 't', description: 'desc' });
    reg.reportProgress(opId, { pct: 10 });
    reg.complete(opId, 'ok');

    expect(events.map((e) => e.transition)).toEqual(['started', 'progress', 'finished']);
    expect(events[0].previousStatus).toBe(null);
    expect(events[1].previousStatus).toBe('started');
    expect(events[2].previousStatus).toBe('progress');
  });

  it('a throwing hook does NOT roll back the in-memory transition', () => {
    const hook = vi.fn(() => { throw new Error('audit-write failed'); });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: AGENTIC_OPERATION_AUDIT_HOOK, useValue: hook }],
    });
    const reg = TestBed.inject(OperationRegistry);
    reg.clear();
    const opId = reg.start({ toolName: 't', description: 't' });
    expect(reg.get(opId)?.status).toBe('started');
    expect(hook).toHaveBeenCalled();
  });

  it('default no-op hook is silent (lib usage without LRO audit wired)', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const reg = TestBed.inject(OperationRegistry);
    reg.clear();
    expect(() => reg.start({ toolName: 't', description: 't' })).not.toThrow();
  });
});
