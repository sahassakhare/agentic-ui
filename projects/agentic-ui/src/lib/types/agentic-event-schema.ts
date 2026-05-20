import { z } from 'zod';

/**
 * Zod discriminated union mirroring the `AgenticEvent` TypeScript type
 * in `agentic-event.ts`. The orchestrator `safeParse`s every event a
 * backend yields before dispatching, so a malformed payload from any
 * adapter is telemetry'd + dropped rather than crashing the run.
 *
 * Slice L3 of docs/plans/library-hardening-plan.md. The pre-existing
 * Hashbrown + A2UI adapters cast wire JSON with `as unknown as
 * AgenticEvent`; this schema is what turns that into a real boundary.
 *
 * Schema-source-of-truth note: keep this file in lockstep with
 * `agentic-event.ts`. Both ship in the published types; adding an
 * event variant requires updating both. The pairing is checked by
 * `agentic-event-schema.spec.ts` which round-trips every TS variant
 * through the Zod parser.
 */

const errorPayload = z.object({
  code: z.string(),
  message: z.string(),
});

const slotDef = z.object({
  component: z.string(),
  props: z.unknown().optional(),
  size: z.object({
    default: z.string(),
    min: z.string().optional(),
    max: z.string().optional(),
  }).optional(),
  pinned: z.boolean().optional(),
  open: z.enum(['inline', 'modal', 'drawer', 'overlay']).optional(),
});

const responsiveRule = z.object({
  belowPx: z.number(),
  collapse: z.array(z.string()),
  drawer: z.array(z.string()),
});

export const agenticEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('run-started'), threadId: z.string(), runId: z.string() }),
  z.object({ type: z.literal('run-finished'), runId: z.string() }),
  z.object({ type: z.literal('run-error'), runId: z.string(), error: errorPayload }),
  z.object({ type: z.literal('text-delta'), messageId: z.string(), delta: z.string() }),
  z.object({ type: z.literal('text-end'), messageId: z.string() }),
  z.object({ type: z.literal('tool-call-start'), toolCallId: z.string(), name: z.string() }),
  z.object({ type: z.literal('tool-call-args'), toolCallId: z.string(), delta: z.string() }),
  z.object({ type: z.literal('tool-call-end'), toolCallId: z.string() }),
  z.object({ type: z.literal('tool-call-result'), toolCallId: z.string(), result: z.unknown() }),
  z.object({ type: z.literal('widget-render'), widgetCallId: z.string(), name: z.string(), props: z.unknown() }),
  z.object({
    type: z.literal('layout-render'),
    layoutName: z.string().optional(),
    slots: z.record(z.string(), slotDef),
    responsive: z.array(responsiveRule).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({ type: z.literal('ui-action'), actionId: z.string(), op: z.string(), payload: z.unknown() }),
  z.object({
    type: z.literal('operation-started'),
    opId: z.string(),
    toolName: z.string(),
    description: z.string(),
    estDurationMs: z.number().optional(),
  }),
  z.object({
    type: z.literal('operation-progress'),
    opId: z.string(),
    pct: z.number(),
    phase: z.string().optional(),
    partialResult: z.unknown().optional(),
  }),
  z.object({
    type: z.literal('operation-finished'),
    opId: z.string(),
    result: z.unknown(),
    durationMs: z.number(),
  }),
  z.object({ type: z.literal('operation-failed'), opId: z.string(), error: errorPayload }),
]);

export type AgenticEventParsed = z.infer<typeof agenticEventSchema>;
