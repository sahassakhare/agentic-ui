# README diagrams

These PNG images are pre-rendered from the `.mmd` (Mermaid) source files in this directory and embedded in [`/README.md`](../../README.md). Pre-rendering means the README shows real graphics in any markdown viewer (npm registry preview, RSS feed readers, IDE preview panes that don't support Mermaid live-rendering, …) — not just on github.com.

## Files

| Source | Output | Where embedded |
|---|---|---|
| [`agentic-ui-flow.mmd`](./agentic-ui-flow.mmd) | [`agentic-ui-flow.png`](./agentic-ui-flow.png) | "What is an 'agentic UI?'" section — sequence diagram of one user prompt → five things |
| [`agentic-ui-architecture.mmd`](./agentic-ui-architecture.mmd) | [`agentic-ui-architecture.png`](./agentic-ui-architecture.png) | "What this library does" section — layered architecture (app → library → adapters → federated remotes) |
| [`registry-tiers.mmd`](./registry-tiers.mmd) | [`registry-tiers.png`](./registry-tiers.png) | "The registry layer up close" — 13 registries grouped into Core / Extended / Seams |
| _(captured live)_ | [`agentic-ui-in-action.png`](./agentic-ui-in-action.png) | Top-of-README hero shot — eDiscovery flagship rendering an `app-custodian-card` widget mid-conversation. Captured by [`scripts/capture-readme-screenshot.mjs`](../../scripts/capture-readme-screenshot.mjs) driving Playwright against a live local deploy. |

## Regenerating the hero screenshot

Unlike the Mermaid diagrams (deterministic from source), the hero PNG is captured from a live app. To regenerate after a UI change:

```bash
# 1. Boot the eDiscovery stack — five terminals, one per service
cd examples/demo-ediscovery-server && npx tsx src/server.ts   # :4311 (needs Gemini key in .env)
npx ng serve demo-ediscovery-shell      --port 4300
npx ng serve demo-ediscovery-review     --port 4302
npx ng serve demo-ediscovery-production --port 4303
npx ng serve demo-ediscovery-search     --port 4304

# 2. Wait until /health on :4311 reports coordinator: gemini-orchestrator,
#    and the four ng-serve sites all 200 OK.

# 3. Run the capture
node scripts/capture-readme-screenshot.mjs
#    Drives a chat turn ("Add Sarah Chen as a custodian"), waits for the
#    app-custodian-card widget, screenshots the viewport at 1600×1000 @ 2x.
```

Custom output path: `node scripts/capture-readme-screenshot.mjs path/to/file.png`.

## Regenerating after edits

Edit the `.mmd` source, then re-render with [`@mermaid-js/mermaid-cli`](https://github.com/mermaid-js/mermaid-cli):

```bash
# Install once (pulls in puppeteer / Chromium — ~150 MB)
npm install --no-save @mermaid-js/mermaid-cli puppeteer

# Render both diagrams
npx mmdc -i docs/assets/agentic-ui-flow.mmd \
         -o docs/assets/agentic-ui-flow.png \
         -b white --width 1400

npx mmdc -i docs/assets/agentic-ui-architecture.mmd \
         -o docs/assets/agentic-ui-architecture.png \
         -b white --width 1400
```

Notes:

- Use **Node 22** for `mmdc` — Node 25 has an ESM resolution bug with the current Chromium download path.
- Keep the `--width 1400` so the rendered text stays readable at the README's natural rendering size on github.com.
- Don't use HTML entities (`&lt;` / `&gt;`) in `.mmd` sources — Mermaid 12's parser breaks on them. Write `mvk-chat-shell` instead of `&lt;mvk-chat-shell&gt;`.

## Why both PNG and Mermaid in the README

The README embeds the PNG **and** keeps the equivalent Mermaid block alongside it. Each renders in different contexts:

| Viewer | PNG renders? | Mermaid renders? |
|---|---|---|
| github.com / GitLab | ✅ | ✅ |
| npm registry preview | ✅ | ❌ |
| Bitbucket | ✅ | ❌ (until 2024) |
| Cursor / VS Code with Mermaid extension | ✅ | ✅ |
| Bare `cat README.md` in a terminal | ❌ | ❌ (ASCII fallback handles this) |
| RSS / Atom feeds, email clients | ✅ | ❌ |

Three layers — ASCII (always), PNG (most viewers), Mermaid (richest live-render) — costs ~150 KB of repo for the PNGs and gives readers the right experience regardless of where they hit the README.
