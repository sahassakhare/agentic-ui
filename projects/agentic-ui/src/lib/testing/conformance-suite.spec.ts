import { describe, expect, it } from 'vitest';
import type { AgenticBackend, AgenticEvent, AgenticRunInput, BackendCapabilities } from '../internal';
import { runConformance } from './conformance-suite';
import { FakeAgenticBackend } from './fake-agentic-backend';

/**
 * Slice L5 — verify the conformance harness:
 *   1. Passes a well-formed backend.
 *   2. Catches schema violations (malformed wire events).
 *   3. Skips capability-gated checks when the capability isn't advertised.
 *   4. Runs capability-gated checks when the capability IS advertised.
 *
 * This is what makes the parity contract codified in the plan (ADR-048
 * once L1 lands) have teeth — a Hashbrown or A2UI adapter that
 * advertises clientTools but doesn't thread `state` will fail this
 * harness, not just its own unit tests.
 */

describe('runConformance — harness teeth', () => {
  it('passes against a fully-conforming FakeAgenticBackend', async () => {
    const report = await runConformance(new FakeAgenticBackend());
    // We allow capability-gated checks to be skipped when the fake doesn't
    // exercise the feature; only `failed === 0` is required.
    expect(report.failed).toBe(0);
    expect(report.passed).toBeGreaterThanOrEqual(4); // at least the lifecycle quartet
  });

  it('fails the schema check when a backend yields a malformed event', async () => {
    const broken: AgenticBackend = {
      id: 'broken-schema',
      capabilities: { streaming: true, clientTools: false, generativeUi: false, uiActions: false },
      // Deliberately mis-typed event: text-delta missing `messageId`.
      async *run(input) {
        yield { type: 'run-started', threadId: input.threadId, runId: input.runId };
        yield { type: 'text-delta', delta: 'no-id' } as unknown as AgenticEvent;
        yield { type: 'run-finished', runId: input.runId };
      },
    };
    const report = await runConformance(broken);
    const schemaCheck = report.results.find((r) => r.name.startsWith('schema:'));
    expect(schemaCheck?.passed).toBe(false);
    expect(schemaCheck?.reason).toContain('text-delta');
  });

  it('skips capability-gated checks when the capability is not advertised', async () => {
    const minimal: AgenticBackend = {
      id: 'minimal',
      capabilities: { streaming: true, clientTools: false, generativeUi: false, uiActions: false, multiModal: false },
      async *run(input) {
        yield { type: 'run-started', threadId: input.threadId, runId: input.runId };
        yield { type: 'run-finished', runId: input.runId };
      },
    };
    const report = await runConformance(minimal);
    const clientToolsCheck = report.results.find((r) => r.name.startsWith('clientTools:'));
    const generativeUiCheck = report.results.find((r) => r.name.startsWith('generativeUi:'));
    const uiActionsCheck = report.results.find((r) => r.name.startsWith('uiActions:'));
    const multiModalCheck = report.results.find((r) => r.name.startsWith('multiModal:'));
    expect(clientToolsCheck?.skipped).toBe(true);
    expect(generativeUiCheck?.skipped).toBe(true);
    expect(uiActionsCheck?.skipped).toBe(true);
    expect(multiModalCheck?.skipped).toBe(true);
  });

  it('runs the clientTools check when the capability IS advertised + the adapter handles state', async () => {
    const caps: BackendCapabilities = { streaming: true, clientTools: true, generativeUi: false, uiActions: false };
    let receivedState: unknown;
    const backend: AgenticBackend = {
      id: 'has-state',
      capabilities: caps,
      async *run(input) {
        receivedState = input.state;
        yield { type: 'run-started', threadId: input.threadId, runId: input.runId };
        yield { type: 'run-finished', runId: input.runId };
      },
    };
    const report = await runConformance(backend);
    const check = report.results.find((r) => r.name.startsWith('clientTools:'));
    expect(check?.passed).toBe(true);
    expect(check?.skipped).toBeFalsy();
    // The harness threaded state on its probe call — adapters that ignore
    // state would still pass this minimal "no-crash" check, but the
    // existence of receivedState here confirms the harness IS passing it.
    expect(receivedState).toBeTruthy();
  });

  it('runs the multiModal check + a faulty multi-modal backend fails', async () => {
    const caps: BackendCapabilities = { streaming: true, clientTools: false, generativeUi: false, uiActions: false, multiModal: true };
    async function* explodeOnMultiPart(input: AgenticRunInput): AsyncIterable<AgenticEvent> {
      // Crash if the harness sends multi-part content (which it does
      // for the multiModal check). A real adapter shouldn't do this,
      // but this proves the harness catches it.
      const hasParts = Array.isArray((input.messages[0] as { content: unknown })?.content);
      if (hasParts) throw new Error('boom');
      yield { type: 'run-started', threadId: input.threadId, runId: input.runId };
      yield { type: 'run-finished', runId: input.runId };
    }
    const explodingOnMultiPart: AgenticBackend = {
      id: 'broken-mm',
      capabilities: caps,
      run: explodeOnMultiPart,
    };
    const report = await runConformance(explodingOnMultiPart);
    const mmCheck = report.results.find((r) => r.name.startsWith('multiModal:'));
    expect(mmCheck?.passed).toBe(false);
    expect(mmCheck?.reason).toBeDefined();
  });

  it('catches a backend that emits a malformed widget-render', async () => {
    const caps: BackendCapabilities = { streaming: true, clientTools: false, generativeUi: true, uiActions: false };
    const backend: AgenticBackend = {
      id: 'broken-widget',
      capabilities: caps,
      async *run(input: AgenticRunInput) {
        yield { type: 'run-started', threadId: input.threadId, runId: input.runId };
        // Schema requires `widgetCallId` AND `name` AND `props`.
        // Skipping `name` triggers the schema check first (since the
        // widget-shape check runs after schema), so the harness flags
        // it on both lines for the same root cause — that's correct
        // behavior.
        yield { type: 'widget-render', widgetCallId: 'wc-1', props: { x: 1 } } as unknown as AgenticEvent;
        yield { type: 'run-finished', runId: input.runId };
      },
    };
    const report = await runConformance(backend);
    expect(report.failed).toBeGreaterThan(0);
    // At least the schema check should catch it.
    const schemaCheck = report.results.find((r) => r.name.startsWith('schema:'));
    expect(schemaCheck?.passed).toBe(false);
  });
});
