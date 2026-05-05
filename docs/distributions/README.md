# Distribution archives

Email-friendly snapshots of the codebase. Use these when you need to ship the whole repo through corporate email filters that block source-code extensions (`.ts`, `.js`, `.json`, `.yml`, `.sh`, …).

## What's in the zip

- **Tracked files only** — anything in `.gitignore` (node_modules, dist, .env, .angular cache, build-deck.py, …) is excluded by definition.
- **Each file has a `.txt` suffix appended.** `package.json` becomes `package.json.txt`, `app.config.ts` becomes `app.config.ts.txt`. The original directory structure is preserved under a top-level `agentic-ui-codebase/` folder inside the zip.
- **Large binary visual artefacts excluded** to keep the zip under email size limits: `.pptx`, `.png`, `.gif`, `.webm`, `.jpg`, `.jpeg`, `.ico`, `.icns`, `.woff`, `.woff2`, `.ttf`, `.eot`, `.mp4`, `.mov`. SVG (text/XML) is included.

| File | Size | Files inside |
|---|---|---|
| [`agentic-ui-codebase.zip`](./agentic-ui-codebase.zip) | ~0.85 MB compressed (~2.3 MB uncompressed) | ~482 source files |

## Sending it

Attach to email — the size fits Gmail (25 MB) and Outlook (20 MB) with room to spare. The `.txt` suffix on every file passes through Microsoft 365 / Google Workspace / corporate Mimecast / Proofpoint filters that strip source-code attachments.

## Restoring on the recipient's end

Once the recipient extracts the zip, they need to strip the `.txt` suffix from every file to get the original extensions back:

```bash
unzip agentic-ui-codebase.zip
cd agentic-ui-codebase
find . -type f -name '*.txt' -exec sh -c 'mv "$0" "${0%.txt}"' {} \;
```

That `find` line renames every `<name>.txt` back to `<name>` in one pass. After that the codebase is identical to a fresh `git clone` (minus the gitignored bits + the excluded binary visuals).

## Regenerating

After making code changes, regenerate the zip with:

```bash
node scripts/make-codebase-zip.mjs
```

The script:
1. Reads the tracked-file list via `git ls-files`
2. Filters out the large binary extensions
3. Streams everything into `docs/distributions/agentic-ui-codebase.zip` with `.txt` appended

First run installs `archiver` as a workspace dep (~30 s); subsequent runs reuse it.

## What's NOT in the zip

The zip is meant for someone who needs to **read** the code. It's not a replacement for `git clone`. Specifically missing:

- The full PowerPoint deck (`docs/decks/agentic-ui-overview.pptx`) — 2.5 MB on its own
- The animated hero GIF (`docs/assets/agentic-ui-in-action.gif`) — 1.6 MB
- All other PNG diagrams + screenshots
- Built artefacts (`dist/`, `node_modules/`)
- Local-only helpers like `docs/decks/build-deck.py` (gitignored)

If the recipient needs the visual artefacts too, point them at the GitHub repo: <https://github.com/sahassakhare/agentic-ui> — same content, with the images.
