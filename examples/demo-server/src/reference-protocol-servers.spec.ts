import { describe, expect, it } from 'vitest';
import { decodeFrames, type Frame } from '@hashbrownai/core';
import { hashbrownReferenceHandler, a2uiReferenceHandler } from './reference-protocol-servers.js';

/**
 * Smoke for the Hashbrown + A2UI reference servers (R1 + R2).
 *
 * Hashbrown speaks its REAL protocol — the response is a length-prefixed
 * `Frame` stream, decoded here with `@hashbrownai/core`'s `decodeFrames`
 * (the same SDK the client adapter uses). A2UI emits canonical
 * AgenticEvent NDJSON. Both are read back and asserted against the wire
 * contract the client adapters parse.
 */

async function readEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Decode a Hashbrown frame Response back into Frame[] via the real SDK. */
async function readFrames(res: Response): Promise<Frame[]> {
  const frames: Frame[] = [];
  for await (const f of decodeFrames(res.body as ReadableStream<Uint8Array>, { signal: new AbortController().signal })) {
    frames.push(f);
  }
  return frames;
}

function req(body: unknown): Request {
  return new Request('http://localhost/agents/x/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('hashbrownReferenceHandler', () => {
  it('emits a real Hashbrown frame stream: generation-start → chunk* → generation-finish', async () => {
    const res = await hashbrownReferenceHandler(req({
      messages: [{ role: 'user', content: 'hello there' }],
      tools: [{ name: 'bookFlight' }],
    }));
    expect(res.headers.get('Content-Type')).toContain('application/octet-stream');
    const frames = await readFrames(res);
    expect(frames[0]).toEqual({ type: 'generation-start' });
    expect(frames.some((f) => f.type === 'generation-chunk')).toBe(true);
    expect(frames.at(-1)).toEqual({ type: 'generation-finish' });
  });

  it('streams the echo as CompletionChunk content deltas (decodable by the client adapter)', async () => {
    const res = await hashbrownReferenceHandler(req({
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'searchDocs' }, { name: 'tagDoc' }],
    }));
    const frames = await readFrames(res);
    const text = frames
      .filter((f): f is Extract<Frame, { type: 'generation-chunk' }> => f.type === 'generation-chunk')
      .map((f) => f.chunk.choices[0]?.delta?.content ?? '')
      .join('');
    expect(text).toContain('searchDocs');
    expect(text).toContain('tagDoc');
    expect(text).toContain('echo: "hi"');
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
