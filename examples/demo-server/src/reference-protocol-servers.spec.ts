import { describe, expect, it } from 'vitest';
import { hashbrownReferenceHandler, a2uiReferenceHandler } from './reference-protocol-servers.js';

/**
 * Smoke for the Hashbrown + A2UI reference servers (R1 + R2). Calls the
 * handlers directly with a mock Request, reads the NDJSON Response
 * stream, and asserts the canonical AgenticEvent sequence — the wire
 * contract the client adapters parse.
 */

async function readEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

function req(body: unknown): Request {
  return new Request('http://localhost/agents/x/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('hashbrownReferenceHandler', () => {
  it('emits a canonical run-started → text-delta* → text-end → run-finished sequence', async () => {
    const res = await hashbrownReferenceHandler(req({
      threadId: 't1', runId: 'r1',
      messages: [{ role: 'user', content: 'hello there' }],
      tools: [{ name: 'bookFlight' }],
      state: { persona: 'lead-counsel' },
    }));
    expect(res.headers.get('Content-Type')).toContain('application/x-ndjson');
    const events = await readEvents(res);
    expect(events[0]).toMatchObject({ type: 'run-started', threadId: 't1', runId: 'r1' });
    expect(events.some((e) => e['type'] === 'text-delta')).toBe(true);
    expect(events.some((e) => e['type'] === 'text-end')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'run-finished', runId: 'r1' });
  });

  it('echoes the received tool names + state keys (proves client serialization)', async () => {
    const res = await hashbrownReferenceHandler(req({
      runId: 'r2',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'searchDocs' }, { name: 'tagDoc' }],
      state: { route: '/workspace' },
    }));
    const events = await readEvents(res);
    const text = events.filter((e) => e['type'] === 'text-delta').map((e) => e['delta']).join('');
    expect(text).toContain('searchDocs');
    expect(text).toContain('tagDoc');
    expect(text).toContain('route');
  });

  it('defaults thread/run ids when omitted', async () => {
    const res = await hashbrownReferenceHandler(req({ messages: [{ role: 'user', content: 'x' }] }));
    const events = await readEvents(res);
    expect((events[0]?.['threadId'] as string)).toMatch(/^thread-/);
    expect((events[0]?.['runId'] as string)).toMatch(/^run-/);
  });
});

describe('a2uiReferenceHandler', () => {
  it('emits a ui-action event before run-finished (the distinguishing A2UI feature)', async () => {
    const res = await a2uiReferenceHandler(req({
      threadId: 't9', runId: 'r9',
      messages: [{ role: 'user', content: 'do a thing' }],
    }));
    const events = await readEvents(res);
    const uiAction = events.find((e) => e['type'] === 'ui-action');
    expect(uiAction).toBeDefined();
    expect(uiAction).toMatchObject({ op: 'notify', actionId: 'act-r9' });
    // run-finished is last, after the ui-action.
    expect(events.at(-1)).toMatchObject({ type: 'run-finished', runId: 'r9' });
    const uiIdx = events.findIndex((e) => e['type'] === 'ui-action');
    const finIdx = events.findIndex((e) => e['type'] === 'run-finished');
    expect(uiIdx).toBeLessThan(finIdx);
  });
});
