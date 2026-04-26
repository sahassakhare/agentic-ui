# User Guide — `@maverick/agentic-ui` MFE Demo

Goal: in ~10 minutes, get an Angular **host** app + an Angular **MFE remote** + a **Gemini-backed agent server** running locally, and see the LLM call a tool from the remote and render its widget in the host. Step-by-step from a fresh clone.

---

## What you'll see when it works

A chat panel where you type:

> Book me a flight from LAX to JFK on 2026-05-15

…and Gemini responds with:
- A **tool-call line** (`→ bookFlight({"from":"LAX","to":"JFK","date":"2026-05-15"})`).
- A **tool-result line** with the booking ID.
- A **boxed flight-card UI component** rendered with the booking details — and that component is defined in a *separate microfrontend* the host loaded at runtime.
- Gemini's natural-language confirmation message.

The boxed card is the proof point. Every layer of the lib (registries, AG-UI adapter, federation, Zod-validated handoffs, generative UI) is exercised end-to-end.

---

## Prerequisites

| Tool | Version | Why |
|------|---------|-----|
| Node.js | 20.19+ (≤ 25.x) | Angular 21 + Hono need a recent Node. |
| npm | 10+ | Workspace install. |
| A Google API key | free tier OK | https://aistudio.google.com/apikey — enables the Gemini agent. Without it the demo falls back to an Echo agent (still useful, but no real LLM). |

---

## Step 1 — Install dependencies

From the workspace root:

```bash
npm install
cd projects/demo-server && npm install && cd ../..
```

The first one installs Angular 21, the lib's peer deps, federation runtimes, etc. The second installs Hono + the Google Gen AI SDK for the agent server.

---

## Step 2 — Add your Gemini key

```bash
cp projects/demo-server/.env.example projects/demo-server/.env
```

Open `projects/demo-server/.env` in your editor and paste your key:

```
GOOGLE_GENERATIVE_AI_API_KEY=AIza...
```

> The `.env` file is git-ignored — your key won't be committed.

If you skip this step the demo still runs (against the Echo agent at `/agents/echo/run`); you'll just see word-by-word echoes instead of LLM responses.

---

## Step 3 — Build the library

```bash
npm run build:lib
```

This builds `dist/agentic-ui` (a single primary entry — see [ADR-005](./adr/0005-single-primary-entry.md)) and copies the schematics. Both demo apps reference the lib via `node_modules/@maverick/agentic-ui` which is linked to `dist/agentic-ui` via the workspace `package.json`'s `file:` dep.

You'll see output ending with:

```
✔ Built @maverick/agentic-ui
Build at: ... - Time: ~5s
```

---

## Step 4 — Open three terminals

You need three processes running concurrently. Open three terminals in the workspace root.

### Terminal 1: agent server

```bash
cd projects/demo-server
npm run dev
```

Wait for:

```
[demo-server] listening on http://localhost:4111
[demo-server]   /health           http://localhost:4111/health
[demo-server]   echo agent (no LLM)   POST http://localhost:4111/agents/echo/run
[demo-server]   gemini agent          POST http://localhost:4111/agents/gemini/run
```

If you see `gemini agent NOT configured`, your `.env` isn't being read — check the path and the variable name (`GOOGLE_GENERATIVE_AI_API_KEY`).

Sanity check from another terminal:

```bash
curl http://localhost:4111/health
# → {"ok":true,"agents":["echo","gemini"],"geminiConfigured":true}
```

### Terminal 2: MFE remote

```bash
npx ng serve demo-remote-bookings
```

Wait for:

```
Application bundle generation complete. ...
  ➜  Local:   http://localhost:4201/
```

Sanity check:

```bash
curl -I http://localhost:4201/remoteEntry.json
# → HTTP/1.1 200 OK
```

The remote exposes one module: `./Capability` (its [`capability.ts`](../projects/demo-remote-bookings/src/app/capability.ts)) which contributes the `bookFlight` tool and `flightCard` widget.

### Terminal 3: host shell

```bash
npx ng serve demo-shell
```

Wait for:

```
Application bundle generation complete. ...
  ➜  Local:   http://localhost:4200/
```

The shell uses `provideAppInitializer` to call `loadRemoteCapabilities` *before* rendering — Angular won't show the chat panel until the remote has registered its capabilities.

---

## Step 5 — Open the app

Open http://localhost:4200 in a browser tab.

### What to verify before typing anything

Open DevTools → Console. You should see:

```
[demo-shell] Remote loaded: demo-remote-bookings (1 tool(s), 1 widget(s))
Angular is running in development mode.
```

> If you see `NG0912: Component ID generation collision` warnings, the federation isn't deduplicating the lib correctly — see [Troubleshooting](#troubleshooting) below.

The page header should read:

```
Capabilities: 1 tool(s) across 1 remote(s): demo-remote-bookings
```

That string is computed from `CapabilityRegistry.list()` and proves the federation handshake worked.

---

## Step 6 — Test the demo

### Test A: streaming text (no tools)

Type **`Hi, what can you do?`**

Expected: Gemini introduces itself as a flight booking assistant, streamed word-by-word into a single assistant bubble.

This validates: chat shell ↔ AG-UI adapter ↔ SSE ↔ agent server ↔ Gemini, plus signal-based delta accumulation.

### Test B: tool calling + generative UI (the headline)

Type **`Book me a flight from LAX to JFK on 2026-05-15`**.

Expected transcript:

```
─── user bubble ──────────────────────────────────
Book me a flight from LAX to JFK on 2026-05-15

─── assistant bubble ─────────────────────────────
→ bookFlight({"from":"LAX","to":"JFK","date":"2026-05-15"})
  ⇒ {"bookingId":"BK-XXXXXX","from":"LAX","to":"JFK","date":"2026-05-15","status":"confirmed",components:[…]}

  ┌─ flight-card widget ───────────────┐
  │  LAX → JFK              ✓ confirmed │
  │  2026-05-15                          │
  │  Booking: BK-XXXXXX                 │
  └─────────────────────────────────────┘

  Your flight from LAX to JFK on 2026-05-15 has been booked!
  Booking confirmation: BK-XXXXXX.
```

The boxed card is `FlightCardComponent`, a standalone Angular component **defined in the remote MFE**, dynamically rendered by the host through `<mvk-widget-container>` via `*ngComponentOutlet`.

### Test C: backend swap

Stop the agent server (Ctrl-C in Terminal 1), then change line ~7 of [`projects/demo-shell/src/app/app.config.ts`](../projects/demo-shell/src/app/app.config.ts):

```ts
const AGENT_URL = 'http://localhost:4111/agents/gemini/run';
// Change to:
const AGENT_URL = 'http://localhost:4111/agents/echo/run';
```

Restart the agent server (`npm run dev` in Terminal 1). Vite will hot-reload the host. Type any message — the response is `You said: <message>` streamed word-by-word.

Same chat shell. Same registries. Same MFE-loaded tools. Just a different backend behind the `AgenticBackend` interface. Switch back to `gemini` when done.

---

## Step 7 — Stop everything

Hit Ctrl-C in each terminal. Or:

```bash
kill $(lsof -ti:4111)   # agent server
kill $(lsof -ti:4200)   # host
kill $(lsof -ti:4201)   # remote
```

---

## Troubleshooting

### Header reads `0 tool(s)` or `no remotes loaded`

The MFE remote didn't load. Check:

- Is `demo-remote-bookings` running on port 4201? `curl -I http://localhost:4201/remoteEntry.json` must return 200.
- Browser DevTools → Network: look for a `Capability.js` request to `:4201`. If it's failing, check the Console for the actual error.
- Is `node_modules/@maverick/agentic-ui` linked to `dist/agentic-ui`? If you reinstalled and the build went stale, run `npm run build:lib && rm -rf node_modules/@maverick && npm install`.

### `NG0912: Component ID generation collision detected`

The lib is being loaded twice (once in the host bundle, once in the remote bundle) instead of being shared via federation. Check:

- Both `projects/demo-shell/federation.config.js` and `projects/demo-remote-bookings/federation.config.js` have `'@maverick/agentic-ui'` in their `shared` block AND `features: { ignoreUnusedDeps: false }`.
- `dist/agentic-ui` exists and was built recently.
- Hard-refresh the browser (Cmd-Shift-R / Ctrl-Shift-R) — Vite dev server may be serving a cached chunk.

### `Error: Unable to resolve specifier '@maverick/agentic-ui'`

Same root cause as NG0912 from a different angle — the federation importmap doesn't have an entry for the lib. Check the same federation config items, then restart the dev server (federation manifest is built once at boot).

### Gemini returns `"NOT_FOUND"` or `models/X is not found`

The model id is stale. Edit `projects/demo-server/src/gemini-agent.ts` (`config.model ?? 'gemini-2.5-flash'`) or set `GEMINI_MODEL` in `.env`. List available models for your key:

```bash
curl "https://generativelanguage.googleapis.com/v1beta/models?key=$GOOGLE_GENERATIVE_AI_API_KEY" \
  | python3 -c "import json,sys; [print(m['name']) for m in json.load(sys.stdin)['models'] if 'generateContent' in m.get('supportedGenerationMethods',[])]"
```

### Tool not called — Gemini asks clarifying questions instead

Most likely the chat shell sent an empty `tools` array because the remote hadn't finished loading. Check:

- The Console shows `[demo-shell] Remote loaded:` *before* you type. If not, the boot sequence isn't blocking on the remote load — verify [`projects/demo-shell/src/app/app.config.ts`](../projects/demo-shell/src/app/app.config.ts) uses `provideAppInitializer` (returns the loadRemote promise), not the older `provideEnvironmentInitializer` (fire-and-forget).

### Port already in use (`EADDRINUSE`)

Free the port:

```bash
kill $(lsof -ti:4111)   # or 4200, 4201
```

---

## Where to go next

- Look at [`projects/demo-remote-bookings/src/app/capability.ts`](../projects/demo-remote-bookings/src/app/capability.ts) to see how the remote contributes tools/widgets.
- Look at [`projects/demo-shell/src/app/app.config.ts`](../projects/demo-shell/src/app/app.config.ts) to see how the host loads remotes at boot.
- Read the cookbook:
  - [Federate an MFE](./cookbook/federate-an-mfe.md)
  - [Swap the backend](./cookbook/swap-backend.md)
  - [Observability](./cookbook/observability.md)
- Generate your own tool / widget / backend with the schematics:
  ```bash
  npx ng g @maverick/agentic-ui:tool myTool --project=demo-monolith
  npx ng g @maverick/agentic-ui:widget MyWidget --project=demo-monolith
  npx ng g @maverick/agentic-ui:backend AcmeBackend --project=demo-monolith
  ```

If anything in this guide doesn't behave as documented, please open an issue with:
- The output of `node --version && npm --version`
- The full Console output from the browser
- The terminal output from each of the three processes around the failure point
