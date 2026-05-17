# Deploying the eDiscovery flagship to Render

Render is the simplest single-platform target for the full eDiscovery stack — it hosts both the long-running Hono agent server (the SSE-streaming chat backend that Netlify Functions can't fit inside their 26-second timeout) **and** the four static Angular sites (host shell + 3 federated remotes) under one project, one Blueprint file, one git push.

The Blueprint at the repo root — [`render.yaml`](../../render.yaml) — describes all five services. One click in Render reads the file, spins up the project, and takes care of the cross-service URL plumbing for you.

## Topology

```
                  ┌─────────────────────────────────────────────────┐
                  │            Render project (single)              │
                  │                                                  │
   browser ──────►│  ediscovery-shell.onrender.com    (static)      │
                  │  · /api/*  →  agent server (rewrite)             │
                  │  · /*      →  /index.html (SPA fallback)         │
                  │                          │                       │
                  │                          ▼                       │
                  │  ediscovery-agent-server.onrender.com  (web)     │
                  │  · Hono + Mastra · Gemini orchestrator           │
                  │                                                  │
                  │  ediscovery-review.onrender.com       (static)   │
                  │  ediscovery-production.onrender.com   (static)   │── all loaded
                  │  ediscovery-search.onrender.com       (static)   │   via federation
                  │                                                  │
                  └─────────────────────────────────────────────────┘
```

All five services live under the same Render project. The shell's build command auto-resolves the four sibling hostnames at build time via `fromService` env vars (Render injects them) — you never copy-paste URLs between dashboards.

## Prerequisites

- A Gemini API key from <https://aistudio.google.com/apikey>
- The repo pushed to GitHub, GitLab, or Bitbucket
- A free Render account

## Step 1 — One-click deploy via Blueprint

1. In Render, click **New +** → **Blueprint**.
2. Pick this repo.
3. Render reads `render.yaml`, shows you the five services it'll create, and asks you to confirm.
4. Click **Apply** and Render starts five parallel builds.

The first deploy takes ~15 minutes for all five services to come up the first time (npm install + library build per service is the bottleneck). Subsequent deploys are faster — Render caches `node_modules`.

> **Why five services not three?** The shell, review, production, and search are *separate* static sites — federation requires each MFE to be loadable from its own origin so the host can `fetch(remoteEntry.json)` cross-origin. If they shared an origin, the federation runtime would load duplicate copies of the agentic-ui library in the shell's heap.

## Step 2 — Set the Gemini API key

The agent server's first build will deploy successfully but health-check at `coordinator: "echo-placeholder"` because the key isn't set yet (the Blueprint marks it `sync: false` so it never lands in git).

1. Open Render → **ediscovery-agent-server** → **Environment** tab.
2. Find `GOOGLE_GENERATIVE_AI_API_KEY` → click **Edit** → paste your key → **Save Changes**.
3. Render redeploys the service automatically (~30 seconds).
4. Verify: `curl https://ediscovery-agent-server.onrender.com/health` should return `{"ok": true, "coordinator": "gemini-orchestrator", ...}`.

## Step 3 — Lock down CORS (recommended)

By default `CORS_ORIGINS` is unset, which the server reads as `*` (any origin can call `/agents/*`). To restrict to just your shell:

1. Render → **ediscovery-agent-server** → **Environment** → `CORS_ORIGINS`.
2. Set value to your shell's URL exactly: `https://ediscovery-shell.onrender.com` (no trailing slash, no path).
3. Save → Render redeploys.

For multiple origins (staging + prod), comma-separate: `https://staging-shell.onrender.com,https://ediscovery-shell.onrender.com`.

## Step 4 — Verify the live deploy

Open your shell URL (Render shows it in the service overview, typically `https://ediscovery-shell.onrender.com`).

Expected:

- Header pill reads "Capabilities loaded · 3 remotes"
- Sidebar shows 17+ tools registered
- Type into chat: *"Add Sarah Chen as a custodian on this matter"* → custodian-card widget renders within ~10 seconds.

## Troubleshooting

**Chat hangs on the loading "…" indicator.**
DevTools → Network. Look for `/api/agents/coordinator/run`.

| What you see | Cause | Fix |
|---|---|---|
| 404 | Shell's `_redirects` missing or stale | Trigger a manual deploy on the shell service to regenerate it. |
| CORS error | Agent server `CORS_ORIGINS` doesn't include shell | Step 3 above. |
| `coordinator: "echo-placeholder"` in `/health` | `GOOGLE_GENERATIVE_AI_API_KEY` not set | Step 2 above. |
| 502 / 503 after several minutes idle | Free-tier sleep | Service wakes on next request (~30s cold start); upgrade to Starter ($7/mo) for no sleep. |

**Shell loads but no remotes register.**
DevTools → Network → look for `mfes.json` and three `remoteEntry.json` fetches.

| What you see | Cause | Fix |
|---|---|---|
| `mfes.json` shows `localhost:4302/4303/4304` | Build env vars didn't substitute | The shell's build command in `render.yaml` uses `fromService` to compose URLs from sibling hostnames at build time — verify the four `*_HOST` env vars exist on the shell service in the Environment tab. They should auto-populate; if not, "Manual Deploy" the shell to retry. |
| `remoteEntry.json` fetches CORS-error | Remote's `[[headers]]` not applying | Open the remote service → Settings → confirm headers are listed. If absent, "Manual Deploy" the remote service to re-apply the Blueprint config. |

**Build fails with "ng: command not found".**
The build command runs `npx ng build ...` to dodge global-install issues. If it still fails, check that `@angular/cli` is in `devDependencies` of the workspace `package.json` (it is — version 21.x).

## Costs

| Plan | Cost | What you get |
|---|---|---|
| Free | $0 | All five services run; agent server sleeps after 15 min idle (~30s cold start on first request after nap). Static sites don't sleep. |
| Starter | **$7/mo** | Agent server has no idle sleep. Static sites still free. |
| Standard | $25/mo | More CPU/RAM for the agent server — only needed if you're running real traffic. |

For most demo and internal-test usage, **Starter on the agent server only** ($7/mo total) is the sweet spot — eliminates the cold-start nap on the chat backend and keeps the four static sites on free tier.

## What's NOT deployed by this Blueprint

- **`demo-ediscovery-mcp`** — stdio MCP server, runs locally inside Claude Desktop (not a web service). To use it: configure `~/Library/Application Support/Claude/claude_desktop_config.json` to spawn the local Node process. See [`docs/cookbook/mcp-server.md`](./mcp-server.md).
- **`demo-ediscovery-shared`** — TypeScript library, not deployed. Built locally and consumed by the shell + server bundles during their respective builds.

## Updating after a code push

`autoDeploy: true` is set on every service in `render.yaml`. Push to your default branch and Render rebuilds + redeploys automatically. No manual step needed.

To deploy from a non-default branch (e.g. a PR), use Render's **Manual Deploy** → **Deploy Branch** option per service, or set `branch: <name>` in `render.yaml`.

## Adapting this Blueprint to your fork

Three things you'll likely want to change:

1. **Service names** — `ediscovery-shell` → `<your-org>-ediscovery-shell` etc. Render appends a random suffix on first deploy if the names collide globally; explicit names give you predictable URLs.
2. **Region** — `oregon` is the default; `frankfurt`, `singapore`, etc. are valid. Pick the one closest to your user base.
3. **Plan** — `starter` on the agent server is the recommended baseline; switch to `free` for short-lived demos or `standard` for production load.

## Known limitations matching the local-dev demo

The eDiscovery demo uses an in-memory mock-data layer, so on Render-hosted deploys (as on local dev):

- State doesn't persist across page reloads — each browser session is a fresh matter.
- Multiple users see independent state (no shared database).
- The `Productions page reflects the new draft / review production` and `chain-of-custody report renders` Playwright tests are marked `test.fixme` because the federated remote's mock-data isn't actually shared with the host's via Native Federation singleton at runtime. Same pattern in dev.

For a real production deployment, replace `mock-data.ts` calls in tools with `inject(DataSourceRegistry).get('documents').query(...)` against a real backend (Postgres + a thin API). See [`docs/cookbook/extended-registries-feature-tour.md`](./extended-registries-feature-tour.md) for the DataSourceRegistry pattern.
