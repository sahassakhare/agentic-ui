import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';

import {
  BackendRegistry,
  injectAgenticChat,
  type AgenticBackend,
  type BackendDef,
  type MessageContent,
} from '../internal';

/**
 * Capability F6 — verify the multi-modal sendMessage path on
 * `AgenticChatRef` (r3 plan §9.6).
 *
 *   - String content path is unchanged (no regression).
 *   - Multi-modal content rides on the user message verbatim when the
 *     active backend advertises `multiModal: true`.
 *   - Multi-modal content is collapsed to a text-only fallback string
 *     when the active backend does NOT advertise multiModal, with a
 *     console warning + telemetry event (AC-F6-4).
 */

function makeFakeBackend(opts: { multiModal: boolean }): BackendDef {
  // Minimal AgenticBackend stub — emits run-finished and nothing else,
  // so runUntilSettled completes immediately without a real LLM call.
  const backend: AgenticBackend = {
    id: opts.multiModal ? 'fake-mm' : 'fake-text',
    capabilities: {
      streaming: true,
      clientTools: false,
      generativeUi: false,
      uiActions: false,
      multiModal: opts.multiModal,
    },
    async *run(_input) {
      yield { type: 'run-started', threadId: _input.threadId, runId: _input.runId };
      yield { type: 'run-finished', runId: _input.runId };
    },
  };
  return {
    name: backend.id,
    id: backend.id,
    label: opts.multiModal ? 'Fake (multi-modal)' : 'Fake (text-only)',
    factory: () => backend,
    capabilities: backend.capabilities,
  };
}

function setupBackend(opts: { multiModal: boolean }): { ref: ReturnType<typeof injectAgenticChat>; warn: ReturnType<typeof vi.fn> } {
  const warn = vi.fn();
  vi.spyOn(console, 'warn').mockImplementation(warn);
  TestBed.runInInjectionContext(() => {
    TestBed.inject(BackendRegistry).register(makeFakeBackend(opts));
    TestBed.inject(BackendRegistry).setActive(opts.multiModal ? 'fake-mm' : 'fake-text');
  });
  let ref!: ReturnType<typeof injectAgenticChat>;
  TestBed.runInInjectionContext(() => {
    ref = injectAgenticChat({});
  });
  return { ref, warn };
}

describe('injectAgenticChat — Capability F6 multi-modal sendMessage', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('string content lands as a string on the AgenticMessage (no regression)', async () => {
    const { ref } = setupBackend({ multiModal: false });
    ref.sendMessage('hello');
    // Wait a microtask so the run-loop kick processes the user message.
    await Promise.resolve();
    const msgs = ref.value();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('hello');
  });

  it('multi-modal content with a multiModal-capable backend rides verbatim', async () => {
    const { ref, warn } = setupBackend({ multiModal: true });
    const parts: readonly MessageContent[] = [
      { kind: 'text', text: 'What custodian is this?' },
      { kind: 'image', mimeType: 'image/png', data: 'data:image/png;base64,xxx', alt: 'screenshot' },
    ];
    ref.sendMessage(parts);
    await Promise.resolve();
    const msgs = ref.value();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toEqual(parts);
    // No warning when the backend advertises support.
    expect(warn).not.toHaveBeenCalled();
  });

  it('multi-modal content with a non-multiModal backend is collapsed to text + warns (AC-F6-4)', async () => {
    const { ref, warn } = setupBackend({ multiModal: false });
    const parts: readonly MessageContent[] = [
      { kind: 'text', text: 'Apply this rubric to the un-tagged set.' },
      { kind: 'file', mimeType: 'application/pdf', filename: 'rubric.pdf', uri: 'data:...' },
    ];
    ref.sendMessage(parts);
    await Promise.resolve();
    const msgs = ref.value();
    expect(msgs).toHaveLength(1);
    expect(typeof msgs[0].content).toBe('string');
    expect(msgs[0].content).toContain('Apply this rubric');
    expect(msgs[0].content).toContain('[file: rubric.pdf]');
    // Console warning fired.
    expect(warn).toHaveBeenCalledOnce();
    expect((warn.mock.calls[0]?.[0] as string) ?? '').toContain('multiModal');
  });

  it('empty arrays are no-ops (no message appended)', () => {
    const { ref } = setupBackend({ multiModal: true });
    const before = ref.value().length;
    ref.sendMessage([]);
    expect(ref.value().length).toBe(before);
  });

  it('whitespace-only string is a no-op', () => {
    const { ref } = setupBackend({ multiModal: false });
    const before = ref.value().length;
    ref.sendMessage('   \n  \t  ');
    expect(ref.value().length).toBe(before);
  });
});
