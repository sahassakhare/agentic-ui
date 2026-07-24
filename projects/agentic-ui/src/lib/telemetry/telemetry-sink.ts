import { Injectable, InjectionToken } from '@angular/core';

export interface TelemetrySpan {
  end(attributes?: Readonly<Record<string, unknown>>): void;
  recordError(error: unknown): void;
  setAttribute(key: string, value: unknown): void;
}

export type TelemetryEventName =
  | 'agentic.run.start'
  | 'agentic.run.end'
  | 'agentic.tool_call.start'
  | 'agentic.tool_call.end'
  | 'agentic.widget.render'
  | 'agentic.federation.load.start'
  | 'agentic.federation.load.end'
  | 'agentic.registry.register'
  | 'agentic.registry.remove'
  | 'agentic.registry.dropped'
  | 'agentic.registry.namespaced'
  | 'agentic.registry.dispose_failed'
  | 'agentic.registry.scope_policy_set'
  | 'agentic.registry.hook_installed'
  | 'agentic.registry.hook_error'
  | 'agentic.registry.host_version_mismatch'
  | 'agentic.platform.capability_registrar.sync'
  | 'agentic.platform.capability_authorizer.refresh'
  | 'agentic.platform.capability_authorizer.refresh_failed'
  | 'agentic.platform.sse.opened'
  | 'agentic.platform.sse.fallback'
  | 'agentic.platform.sse.event_received'
  | 'agentic.platform.sse.parse_error'
  | 'agentic.platform.opa.decision'
  | 'agentic.platform.opa.decision_failed'
  | 'agentic.trigger.fire'
  | 'agentic.trigger.error'
  // L3 — orchestrator-boundary validation. Emitted when a backend
  // yields an event whose shape doesn't match `agenticEventSchema`;
  // the orchestrator drops the event and continues so a malformed
  // wire payload can't crash the run.
  | 'agentic.run.malformed_event'
  // MCP-UI inbound rendering (Phase 1). Emitted when a sandboxed
  // UIResource's postMessage action is refused — bad origin, malformed
  // payload, or a tool the active persona can't invoke. See ADR-049.
  | 'agentic.mcp_ui.action_blocked'
  // WebMCP expose (Phase 2, @infra-tools/agentic-ui-webmcp). See ADR-050.
  // `unavailable` — navigator.modelContext not present (no-op degrade).
  // `call_blocked` — an inbound call hit a tool the scope policy hides.
  // `call_queued_for_approval` — an inbound call matched an approval policy.
  | 'agentic.webmcp.unavailable'
  | 'agentic.webmcp.call_blocked'
  | 'agentic.webmcp.call_queued_for_approval'
  // AEP Seam D — Experience Planner decisions. The planner is an access
  // decision point (deny by persona / approval), so every plan and every
  // denial must be observable for enterprise audit/traceability.
  // `plan` — a plan was produced (attrs: experienceId, persona, tool/unmet counts).
  // `access_denied` — the access gate denied (attrs: experienceId, persona, reason).
  // `unresolved` — a produced plan carried unmet required capabilities.
  // `approval_transition` — an experience approval state changed (attrs: from/to/action/actor).
  | 'agentic.experience.plan'
  | 'agentic.experience.access_denied'
  | 'agentic.experience.unresolved'
  | 'agentic.experience.approval_transition';

export interface AgenticTelemetrySink {
  startSpan(name: TelemetryEventName, attributes?: Readonly<Record<string, unknown>>): TelemetrySpan;
  emit(name: TelemetryEventName, attributes?: Readonly<Record<string, unknown>>): void;
  counter(name: string, value: number, attributes?: Readonly<Record<string, unknown>>): void;
  histogram(name: string, value: number, attributes?: Readonly<Record<string, unknown>>): void;
}

class NoopSpan implements TelemetrySpan {
  end(): void {}
  recordError(): void {}
  setAttribute(): void {}
}

const NOOP_SPAN = new NoopSpan();

@Injectable({ providedIn: 'root' })
export class NoopTelemetrySink implements AgenticTelemetrySink {
  startSpan(): TelemetrySpan {
    return NOOP_SPAN;
  }
  emit(): void {}
  counter(): void {}
  histogram(): void {}
}

export const AGENTIC_TELEMETRY_SINK = new InjectionToken<AgenticTelemetrySink>(
  'AGENTIC_TELEMETRY_SINK',
  { providedIn: 'root', factory: () => new NoopTelemetrySink() },
);
