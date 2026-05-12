# @infra-tools/agentic-ui-copilot-skill

GitHub Copilot Extensions adapter for the `@infra-tools/agentic-ui`
platform. Lets GitHub Copilot Chat (across VS Code, JetBrains,
github.com) invoke any tool registered with our catalog through
a thin server-side webhook.

This is **Path 2a** in
[docs/plans/teams-copilot-integration-plan.md](../../docs/plans/teams-copilot-integration-plan.md)
and is shipped under the architectural contract of
[ADR-041](../../docs/adr/0041-teams-copilot-external-surfaces.md).

## Why a separate package

GitHub Copilot Chat's wire format is OpenAI-shaped Chat Completion
SSE chunks, plus a few Copilot-specific headers and a signed-request
verification step. Wrapping every adopter's agent server in that
boilerplate is exactly what the adapter pattern (ADR-006) was
written for: one new package, the catalog and the chat shell stay
untouched.

## What's in it

The package is intentionally **transport + protocol only**. It does
NOT embed a model, does NOT depend on Angular, does NOT depend on
the catalog server. Adopters bring their own LLM behind a
`SkillHandler` and their own auth layer in front.

| Export | Purpose |
|---|---|
| `verifyCopilotRequest(opts)` | Validate the `X-GitHub-Public-Key-Signature` header against GitHub's published keys |
| `resolveCopilotKey(keyId)` | Fetch + cache a key from `api.github.com/meta/public_keys/copilot_api` |
| `parseCopilotRequest(json)` | Type-guarded read of `{messages, copilot_thread_id, copilot_skills}` |
| `readCopilotIdentity(headers)` | Pull the GitHub user / enterprise / orgs from request headers |
| `encodeAsChunk(event, opts)` | Serialise one `SkillEvent` as an OpenAI Chat Completion chunk |
| `streamCopilotResponse(events, write, opts)` | Drive a `SkillHandler`'s async-iter into the SSE stream + terminal `[DONE]` |
| `createCopilotSkillMiddleware({ handler, ... })` | Connect-style middleware that ties everything together |
| Types: `SkillEvent`, `SkillHandler`, `CopilotRequestBody`, `CopilotIdentity`, `CopilotMessage` | Public types |

## Wire it up (Express, ~20 lines)

```ts
import express from 'express';
import {
  createCopilotSkillMiddleware,
  type SkillHandler,
} from '@infra-tools/agentic-ui-copilot-skill';

// Plug your own LLM behind this handler. The example uses a stub
// that just echoes back. In production you'd call Gemini / OpenAI
// / Anthropic with the tool catalog from your catalog server.
const handler: SkillHandler = async function*({ body, identity }) {
  yield { type: 'text-delta', delta: `Hi ${identity.githubUserLogin ?? 'there'}.` };
  yield { type: 'text-delta', delta: '\n\nReceived ' + body.messages.length + ' message(s).' };
  yield { type: 'finish', reason: 'stop' };
};

const app = express();
app.post(
  '/copilot/skill',
  express.raw({ type: 'application/json', limit: '2mb' }),
  createCopilotSkillMiddleware({
    handler,
    skipSignatureVerification: process.env['NODE_ENV'] !== 'production',
  }),
);
app.listen(8080, () => console.log('skill listening on :8080'));
```

The middleware:
1. Reads the raw body (raw, not parsed -- needed for signature
   verification).
2. Verifies the GitHub signature unless `skipSignatureVerification`
   is set (typically only in local dev).
3. Parses the JSON body and rejects 400 on malformed payloads.
4. Streams chunks via `streamCopilotResponse`.

## Wire to a real agent

Replace the stub `handler` with your existing agent loop. If
you're using `@infra-tools/agentic-ui-server`'s AG-UI Agent
interface, the shape maps cleanly:

```ts
const handler: SkillHandler = async function*({ body, identity, signal }) {
  // 1. Map GitHub identity -> catalog principal.
  const principal = await mapGitHubIdentityToCatalog(identity);

  // 2. Run the agent against your registered tools.
  const stream = yourAgent.run({
    messages: body.messages,
    principal,
    signal,
  });

  // 3. Bridge AG-UI events -> SkillEvent.
  for await (const ev of stream) {
    if (ev.type === 'TEXT_MESSAGE_CONTENT') {
      yield { type: 'text-delta', delta: ev.delta };
    } else if (ev.type === 'TOOL_CALL_START') {
      // accumulate args until TOOL_CALL_END, then yield
    } else if (ev.type === 'TOOL_CALL_RESULT') {
      yield { type: 'tool-call', toolCallId: ev.id, name: ev.name, args: ev.args };
      yield { type: 'tool-result', toolCallId: ev.id, result: ev.result };
    } else if (ev.type === 'RUN_FINISHED') {
      yield { type: 'finish', reason: 'stop' };
    }
  }
};
```

## GitHub App + Marketplace listing

Production deployment needs:

1. **GitHub App registration** — one per environment. The app's
   webhook URL points at your `POST /copilot/skill` endpoint. The
   app declares the `read:user` OAuth scope so identity headers
   land on the webhook.
2. **Copilot Extension manifest** at the repo root, declaring the
   skill name + webhook URL.
3. **Marketplace listing** if you want public availability. Private
   org installs work without listing.

See [docs/cookbook/github-copilot-extension.md](../../docs/cookbook/github-copilot-extension.md)
for the end-to-end walkthrough.

## Spec coverage

17 tests cover the protocol layer:

- `parseCopilotRequest`: valid body, dropped-field handling,
  null on missing fields, optional `copilot_skills`.
- `readCopilotIdentity`: header presence + multi-value parsing.
- `encodeAsChunk`: text deltas (role on first chunk only), tool
  calls, finish reason mapping.
- `streamCopilotResponse`: chunk ordering, terminal `[DONE]`,
  synthetic finish when handler forgets.
- `verifyCopilotRequest`: missing headers, unknown key, tampered
  signature, valid signature (real ECDSA P-256 round-trip).

Run `npm test` from the package directory.

## What this does NOT do

- **No LLM.** Adopters bring their own.
- **No tool registry sync.** The catalog server is the source of
  truth; this skill consumes whatever tools the handler advertises
  to its LLM.
- **No audit fan-in.** ADR-041 D3 adds an `origin` field to audit
  events; adopters wiring this skill should pass
  `origin: 'github-copilot'` when their handler calls the catalog
  audit endpoint.
- **No long-running operations.** Copilot Chat is request/response;
  long F5 tools should kick off the operation, return an `opId`,
  and let users check status with a follow-up turn.

## Status

v0.1.0 — protocol layer + middleware shipped, two-week vertical
slice from the integration plan. Not yet wired against a live LLM
in this repo; first adopter integration is the next milestone.
