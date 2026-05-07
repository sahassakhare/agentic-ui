import { Injectable, InjectionToken, computed, inject, signal, type Signal } from '@angular/core';
import type {
  Operation,
  OperationError,
  OperationProgress,
  OperationStartMeta,
  OperationStatus,
} from '../types/registry-defs';

/**
 * Audit hook payload — fires after every Operation lifecycle transition.
 * Hosts wire this to mirror operations into their audit chain (per r3
 * plan §7.8 + AC-F5-5).
 */
export interface OperationAuditEvent {
  readonly operation: Operation;
  readonly transition: 'started' | 'progress' | 'finished' | 'failed';
  readonly previousStatus: OperationStatus | null;
}

/**
 * Default no-op so libraries that don't wire LRO audit pay nothing.
 *
 * @example
 * ```ts
 * { provide: AGENTIC_OPERATION_AUDIT_HOOK, useFactory: () => {
 *     return ({ operation, transition }) => appendAudit({
 *       action: `operation-${transition}`,
 *       target: { type: 'operation', id: operation.opId },
 *       ...
 *     });
 *   }
 * }
 * ```
 */
export const AGENTIC_OPERATION_AUDIT_HOOK = new InjectionToken<(event: OperationAuditEvent) => void>(
  'AGENTIC_OPERATION_AUDIT_HOOK',
  { providedIn: 'root', factory: () => () => {} },
);

/**
 * Per-renderer / per-host registry of long-running operations
 * (Capability F5 — r3 plan §9.5). Tools start operations via
 * `ToolContext.startOperation(...)`, then call `reportProgress` /
 * `completeOperation` / `failOperation` to drive the lifecycle.
 *
 * Reads are reactive: the `<mvk-operation-progress>` widget and
 * the `/operations` queue page subscribe via `operations()`
 * (computed) and update without polling.
 *
 * Persistence is delegated to the host: a deployment can wire
 * `PersistenceRegistry` to mirror operations into a durable store —
 * the registry itself stays in-memory for the demo, which is enough
 * to drive the widget + audit chain.
 *
 * Audit posture: every transition fires the
 * {@link AGENTIC_OPERATION_AUDIT_HOOK} after in-memory state is
 * updated. Throwing hooks do NOT roll back — same separation of
 * concerns as F4's approval audit hook (ADR-009).
 */
@Injectable({ providedIn: 'root' })
export class OperationRegistry {
  private readonly records = signal<Readonly<Record<string, Operation>>>({});
  private readonly auditHook = inject(AGENTIC_OPERATION_AUDIT_HOOK);
  private readonly idCounter = signal(0);

  /** Reactive view of all operations (any status), ordered by startedAt asc. */
  readonly operations: Signal<readonly Operation[]> = computed(() => {
    const all = Object.values(this.records());
    return all.sort((a, b) =>
      a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0,
    );
  });

  /** Read a single operation by id; `undefined` if unknown. */
  get(opId: string): Operation | undefined {
    return this.records()[opId];
  }

  /** Filter by status (sorted by startedAt). */
  byStatus(status: OperationStatus): readonly Operation[] {
    return this.operations().filter((o) => o.status === status);
  }

  /** Operations that have not reached a terminal status — still running. */
  active(): readonly Operation[] {
    return this.operations().filter(
      (o) => o.status === 'started' || o.status === 'progress',
    );
  }

  /**
   * Mint a new operation. Returns the generated `opId`. Auto-stamps
   * `startedAt` and emits the audit event.
   */
  start(meta: OperationStartMeta & { threadId?: string; runId?: string; toolCallId?: string }): string {
    const opId = this.mintId();
    const op: Operation = {
      opId,
      toolName: meta.toolName ?? 'unknown',
      description: meta.description,
      status: 'started',
      startedAt: new Date().toISOString(),
      estDurationMs: meta.estDurationMs,
      threadId: meta.threadId,
      runId: meta.runId,
      toolCallId: meta.toolCallId,
    };
    this.records.update((s) => ({ ...s, [opId]: op }));
    this.fireAudit({ operation: op, transition: 'started', previousStatus: null });
    return opId;
  }

  /** Update an in-flight operation with progress. Idempotent on terminal ops. */
  reportProgress(opId: string, progress: OperationProgress): void {
    const cur = this.records()[opId];
    if (!cur) return; // unknown opId — silent no-op (matches LRO semantics)
    if (cur.status === 'finished' || cur.status === 'failed') return;
    const updated: Operation = {
      ...cur,
      status: 'progress',
      pct: clampPct(progress.pct),
      phase: progress.phase ?? cur.phase,
      partialResult: progress.partialResult ?? cur.partialResult,
    };
    this.records.update((s) => ({ ...s, [opId]: updated }));
    this.fireAudit({ operation: updated, transition: 'progress', previousStatus: cur.status });
  }

  /** Terminal-success transition. */
  complete(opId: string, result: unknown): void {
    const cur = this.records()[opId];
    if (!cur) return;
    if (cur.status === 'finished' || cur.status === 'failed') return;
    const finishedAt = new Date().toISOString();
    const durationMs = Date.parse(finishedAt) - Date.parse(cur.startedAt);
    const updated: Operation = {
      ...cur,
      status: 'finished',
      pct: 100,
      finishedAt,
      durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
      result,
    };
    this.records.update((s) => ({ ...s, [opId]: updated }));
    this.fireAudit({ operation: updated, transition: 'finished', previousStatus: cur.status });
  }

  /** Terminal-failure transition. */
  fail(opId: string, error: OperationError): void {
    const cur = this.records()[opId];
    if (!cur) return;
    if (cur.status === 'finished' || cur.status === 'failed') return;
    const finishedAt = new Date().toISOString();
    const durationMs = Date.parse(finishedAt) - Date.parse(cur.startedAt);
    const updated: Operation = {
      ...cur,
      status: 'failed',
      finishedAt,
      durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
      error,
    };
    this.records.update((s) => ({ ...s, [opId]: updated }));
    this.fireAudit({ operation: updated, transition: 'failed', previousStatus: cur.status });
  }

  /** Drop a record outright (test reset; does not emit audit). */
  remove(opId: string): void {
    this.records.update((s) => {
      if (!(opId in s)) return s;
      const next = { ...s };
      delete next[opId];
      return next;
    });
  }

  /** Reset to empty (test isolation; does not emit audit). */
  clear(): void {
    this.records.set({});
    this.idCounter.set(0);
  }

  private mintId(): string {
    const n = this.idCounter() + 1;
    this.idCounter.set(n);
    // Encode timestamp + counter so ids are sortable + unique across resets.
    return `op-${Date.now().toString(36)}-${n.toString(36).padStart(3, '0')}`;
  }

  private fireAudit(event: OperationAuditEvent): void {
    try {
      this.auditHook(event);
    } catch {
      // Hook failures must not roll back the in-memory transition
      // (same contract as F4's approval audit — ADR-009).
    }
  }
}

function clampPct(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}
