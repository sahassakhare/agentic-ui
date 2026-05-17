import { describe, expect, it } from 'vitest';
import {
  encodeAsChunk,
  parseCopilotRequest,
  readCopilotIdentity,
  streamCopilotResponse,
  verifyCopilotRequest,
  type SkillEvent,
} from './index.js';
import { createSign, generateKeyPairSync } from 'node:crypto';

describe('parseCopilotRequest', () => {
  it('keeps valid messages with role + content', () => {
    const parsed = parseCopilotRequest({
      messages: [
        { role: 'system', content: 'be helpful' },
        { role: 'user', content: 'place a legal hold' },
      ],
      copilot_thread_id: 't-1',
    });
    expect(parsed?.messages.length).toBe(2);
    expect(parsed?.messages[0]?.role).toBe('system');
    expect(parsed?.copilot_thread_id).toBe('t-1');
  });

  it('drops messages with non-string role/content', () => {
    const parsed = parseCopilotRequest({
      messages: [
        { role: 'user', content: 'ok' },
        { role: 'user', content: 42 as unknown as string },
        { role: 'banana', content: 'ok' } as unknown as { role: 'user'; content: string },
      ],
    });
    expect(parsed?.messages.length).toBe(1);
  });

  it('returns null when messages array is missing', () => {
    expect(parseCopilotRequest({ foo: 'bar' })).toBeNull();
    expect(parseCopilotRequest({ messages: 'not array' as unknown as [] })).toBeNull();
    expect(parseCopilotRequest(null)).toBeNull();
    expect(parseCopilotRequest('string')).toBeNull();
  });

  it('returns null when every message is invalid', () => {
    const parsed = parseCopilotRequest({
      messages: [{ role: 42, content: 'x' }, { role: 'user' }],
    });
    expect(parsed).toBeNull();
  });

  it('keeps optional copilot_skills', () => {
    const parsed = parseCopilotRequest({
      messages: [{ role: 'user', content: 'hi' }],
      copilot_skills: ['ediscovery-skill', 'compliance-skill', 99],
    });
    expect(parsed?.copilot_skills).toEqual(['ediscovery-skill', 'compliance-skill']);
  });
});

describe('readCopilotIdentity', () => {
  it('reads GitHub headers (lower-case keys)', () => {
    const id = readCopilotIdentity({
      'x-github-user': 'sahas',
      'x-github-user-id': '12345',
      'x-github-enterprise': 'maverick',
      'x-github-org': 'acme,beta',
    });
    expect(id.githubUserLogin).toBe('sahas');
    expect(id.githubUserId).toBe('12345');
    expect(id.enterprise).toBe('maverick');
    expect(id.orgs).toEqual(['acme', 'beta']);
  });

  it('returns nulls + empty list when headers absent', () => {
    const id = readCopilotIdentity({});
    expect(id.githubUserLogin).toBeNull();
    expect(id.githubUserId).toBeNull();
    expect(id.enterprise).toBeNull();
    expect(id.orgs).toEqual([]);
  });
});

describe('encodeAsChunk', () => {
  const opts = { runId: 'r-1', idx: 0 };

  it('encodes a text-delta as an OpenAI chunk with role on first chunk', () => {
    const out = encodeAsChunk({ type: 'text-delta', delta: 'Hello' }, opts);
    expect(out.startsWith('data: ')).toBe(true);
    const payload = JSON.parse(out.slice('data: '.length).trim());
    expect(payload.choices[0].delta).toMatchObject({ role: 'assistant', content: 'Hello' });
    expect(payload.choices[0].finish_reason).toBeNull();
  });

  it('omits role on follow-up chunks', () => {
    const out = encodeAsChunk(
      { type: 'text-delta', delta: ' world' },
      { ...opts, idx: 1 },
    );
    const payload = JSON.parse(out.slice('data: '.length).trim());
    expect(payload.choices[0].delta.role).toBeUndefined();
    expect(payload.choices[0].delta.content).toBe(' world');
  });

  it('encodes a tool-call with name + JSON arguments', () => {
    const out = encodeAsChunk(
      { type: 'tool-call', toolCallId: 'call-1', name: 'placeLegalHold', args: { scope: 'phx' } },
      opts,
    );
    const payload = JSON.parse(out.slice('data: '.length).trim());
    const tc = payload.choices[0].delta.tool_calls[0];
    expect(tc).toMatchObject({ id: 'call-1', type: 'function' });
    expect(tc.function.name).toBe('placeLegalHold');
    expect(JSON.parse(tc.function.arguments)).toEqual({ scope: 'phx' });
  });

  it('encodes a finish event with the supplied reason', () => {
    const out = encodeAsChunk({ type: 'finish', reason: 'tool_calls' }, opts);
    const payload = JSON.parse(out.slice('data: '.length).trim());
    expect(payload.choices[0].finish_reason).toBe('tool_calls');
  });
});

describe('streamCopilotResponse', () => {
  it('emits chunks in order, ends with [DONE]', async () => {
    const chunks: string[] = [];
    const events: SkillEvent[] = [
      { type: 'text-delta', delta: 'Working' },
      { type: 'text-delta', delta: '...' },
      { type: 'finish', reason: 'stop' },
    ];
    await streamCopilotResponse(asyncIter(events), (c) => chunks.push(c), { runId: 'r-7' });
    expect(chunks.length).toBe(4);                  // 3 events + [DONE]
    expect(chunks[chunks.length - 1]).toBe('data: [DONE]\n\n');
    const parsed = chunks.slice(0, 3).map((c) => JSON.parse(c.slice('data: '.length).trim()));
    expect(parsed[0].choices[0].delta.content).toBe('Working');
    expect(parsed[2].choices[0].finish_reason).toBe('stop');
  });

  it('auto-emits a finish chunk when the handler forgets', async () => {
    const chunks: string[] = [];
    await streamCopilotResponse(asyncIter([
      { type: 'text-delta', delta: 'only-one' } as SkillEvent,
    ]), (c) => chunks.push(c), { runId: 'r-8' });
    // 1 text + 1 synthetic finish + [DONE]
    expect(chunks.length).toBe(3);
    const finish = JSON.parse(chunks[1]!.slice('data: '.length).trim());
    expect(finish.choices[0].finish_reason).toBe('stop');
  });
});

describe('verifyCopilotRequest', () => {
  it('rejects when signature/key headers are missing', async () => {
    const r = await verifyCopilotRequest({
      rawBody: Buffer.from('{}'),
      signatureHeader: null,
      keyIdentifierHeader: null,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('missing-headers');
  });

  it('rejects when the key resolver returns null', async () => {
    const r = await verifyCopilotRequest({
      rawBody: Buffer.from('{}'),
      signatureHeader: 'fake',
      keyIdentifierHeader: 'unknown-key',
      resolveKey: async () => null,
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('unknown-key');
  });

  it('rejects a tampered signature', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const body = Buffer.from('hello');
    const signer = createSign('SHA256');
    signer.update(body);
    signer.end();
    const sig = signer.sign(privateKey).toString('base64');
    // Flip a few bytes so the signature won't verify.
    const tampered = Buffer.from(sig, 'base64');
    tampered[0]! ^= 0xff;
    const r = await verifyCopilotRequest({
      rawBody: body,
      signatureHeader: tampered.toString('base64'),
      keyIdentifierHeader: 'kid-1',
      resolveKey: async () => publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    });
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('bad-signature');
  });

  it('accepts a valid signature', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const body = Buffer.from('{"messages":[{"role":"user","content":"hi"}]}');
    const signer = createSign('SHA256');
    signer.update(body);
    signer.end();
    const sig = signer.sign(privateKey).toString('base64');
    const r = await verifyCopilotRequest({
      rawBody: body,
      signatureHeader: sig,
      keyIdentifierHeader: 'kid-1',
      resolveKey: async () => publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    });
    expect(r.valid).toBe(true);
  });
});

async function* asyncIter<T>(items: readonly T[]): AsyncIterable<T> {
  for (const it of items) yield it;
}
