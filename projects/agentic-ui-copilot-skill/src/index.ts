export type {
  CopilotIdentity,
  CopilotMessage,
  CopilotRequestBody,
  SkillEvent,
  SkillHandler,
} from './types.js';

export { parseCopilotRequest, readCopilotIdentity } from './request.js';
export { verifyCopilotRequest, resolveCopilotKey } from './verify.js';
export type { VerifyOptions, VerifyResult } from './verify.js';
export { encodeAsChunk, streamCopilotResponse } from './stream.js';

import type { SkillHandler } from './types.js';
import { parseCopilotRequest, readCopilotIdentity } from './request.js';
import { verifyCopilotRequest } from './verify.js';
import { streamCopilotResponse } from './stream.js';

/**
 * Connect-style middleware that turns a `SkillHandler` into an
 * Express / Connect / Node-HTTP request handler. Suitable for
 * mounting at `/copilot/skill`.
 *
 * Verifies the GitHub signature, parses the body, runs the
 * handler, and streams OpenAI-shaped Chat Completion chunks back.
 *
 * Usage (Express):
 * ```ts
 * import express from 'express';
 * import { createCopilotSkillMiddleware } from '@maverick/agentic-ui-copilot-skill';
 *
 * const app = express();
 * app.post('/copilot/skill',
 *   express.raw({ type: 'application/json', limit: '2mb' }),  // raw body for signature
 *   createCopilotSkillMiddleware({
 *     handler: yourSkillHandler,
 *     skipSignatureVerification: process.env.NODE_ENV !== 'production',
 *   }),
 * );
 * ```
 *
 * Adopters who don't use Express can call the lower-level
 * functions directly: parseCopilotRequest, verifyCopilotRequest,
 * streamCopilotResponse.
 */
export interface CreateMiddlewareOptions {
  readonly handler: SkillHandler;
  /** Override the auto-detected GitHub signature verifier. Useful
   *  for tests + local development. */
  readonly skipSignatureVerification?: boolean;
  /** Optional run-id factory. Defaults to `randomUUID()`. */
  readonly runId?: () => string;
  /** Override the model name surfaced in chunks. */
  readonly model?: string;
}

export function createCopilotSkillMiddleware(opts: CreateMiddlewareOptions) {
  return async function copilotSkillHandler(
    req: NodeRequestLike,
    res: NodeResponseLike,
  ): Promise<void> {
    // 1. Read the raw body. We expect Express to have parsed it via
    //    `express.raw()` (Buffer); fall back to a stream read for
    //    Node-HTTP integrators.
    const rawBody = await readRawBody(req);

    // 2. Verify the signature unless explicitly skipped.
    if (!opts.skipSignatureVerification) {
      const verified = await verifyCopilotRequest({
        rawBody,
        signatureHeader: headerOf(req, 'x-github-public-key-signature'),
        keyIdentifierHeader: headerOf(req, 'x-github-public-key-identifier'),
      });
      if (!verified.valid) {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'signature-verification-failed', reason: verified.reason }));
        return;
      }
    }

    // 3. Parse the body.
    let parsed;
    try {
      parsed = parseCopilotRequest(JSON.parse(rawBody.toString('utf8')));
    } catch {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'invalid-json' }));
      return;
    }
    if (!parsed) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'invalid-body', detail: 'missing messages' }));
      return;
    }

    // 4. Stream the response.
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const identity = readCopilotIdentity(req.headers as Record<string, string | string[] | undefined>);
    const abort = new AbortController();
    req.on?.('close', () => abort.abort());

    const runId = opts.runId?.() ?? randomId();
    const events = opts.handler({ body: parsed, identity, signal: abort.signal });
    try {
      await streamCopilotResponse(events, (chunk) => res.write(chunk), {
        runId,
        ...(opts.model !== undefined ? { model: opts.model } : {}),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[copilot-skill] handler threw:', err);
      try { res.write(`event: error\ndata: ${JSON.stringify({ message: 'internal-error' })}\n\n`); } catch { /* writer closed */ }
    } finally {
      res.end();
    }
  };
}

// ── helpers ────────────────────────────────────────────────────────

interface NodeRequestLike {
  readonly headers: Record<string, string | string[] | undefined>;
  on?: (event: string, listener: () => void) => void;
  body?: Buffer | string;
  [Symbol.asyncIterator]?: () => AsyncIterator<Buffer>;
}

interface NodeResponseLike {
  statusCode: number;
  setHeader(name: string, value: string): void;
  flushHeaders?: () => void;
  write(chunk: string): boolean;
  end(payload?: string): void;
}

function headerOf(req: NodeRequestLike, name: string): string | null {
  const v = req.headers[name] ?? req.headers[name.toLowerCase()];
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v[0] ?? null;
  return null;
}

async function readRawBody(req: NodeRequestLike): Promise<Buffer> {
  // express.raw() leaves a Buffer on req.body.
  if (req.body instanceof Buffer) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
  // Fall back to stream read (raw Node-HTTP integrators).
  if (req[Symbol.asyncIterator]) {
    const chunks: Buffer[] = [];
    for await (const c of req as unknown as AsyncIterable<Buffer>) chunks.push(c);
    return Buffer.concat(chunks);
  }
  return Buffer.alloc(0);
}

function randomId(): string {
  return 'run-' + Math.random().toString(36).slice(2, 10);
}
