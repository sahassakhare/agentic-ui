#!/usr/bin/env node
/**
 * Re-encode the post-chat-surfaces tour `.webm` files (Playwright
 * recordings) into optimized `.gif` files for inline rendering on
 * github.com. GitHub strips <video> tags but happily renders ![]()
 * image embeds.
 *
 * Auto-trims the blank page-load prefix off each video before
 * encoding. Playwright video recording starts when the BrowserContext
 * is created, which is before `page.goto` — so the first ~25-35
 * seconds of every recording is `about:blank` + the Render
 * cold-start (container spin-up + federation + Angular hydration).
 * The actual user-visible content only appears in the second half.
 *
 * Usage (from repo root):
 *
 *   # First refresh the recordings:
 *   cd e2e && EDIS_BASE_URL=https://ediscovery-shell.onrender.com \
 *     npx playwright test specs/11-post-chat-surfaces.spec.ts
 *   cd ..
 *
 *   # Copy fresh .webm into docs/assets/videos/, then encode:
 *   node scripts/encode-tour-gifs.mjs
 *
 * Encoding choices:
 *   - Auto-trim: scan a frame every second, drop the prefix where
 *     the frame's PNG-encoded size is below a "blank-frame" threshold
 *     (~6 KB at 800×450 — solid-colour frame). First frame ≥ 50 KB
 *     marks content start.
 *   - 8 fps, 900 px wide, two-pass palette + bayer dither — same as
 *     before, just applied to the trimmed clip.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let ffmpegPath;
try {
  ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
} catch {
  console.error('Missing @ffmpeg-installer/ffmpeg. Install it with:');
  console.error('  npm install --no-save @ffmpeg-installer/ffmpeg');
  process.exit(1);
}

const VIDEOS_DIR = 'docs/assets/videos';
const GIFS_DIR = 'docs/assets/gifs';
const CONTENT_FRAME_THRESHOLD = 50_000; // bytes — frames smaller than this are blank
const SCAN_DIR = '/tmp/encode-tour-scan';
const TARGET_FPS = 6;          // 6 fps is enough for UI walkthroughs
const TARGET_WIDTH = 720;      // 720 px keeps the chrome readable; -1 keeps aspect
const MAX_DURATION = 20;       // seconds — cap each GIF so the tail doesn't bloat the file

if (!existsSync(VIDEOS_DIR)) {
  console.error(`No ${VIDEOS_DIR} — run the Playwright spec first.`);
  process.exit(1);
}
mkdirSync(GIFS_DIR, { recursive: true });
rmSync(SCAN_DIR, { recursive: true, force: true });
mkdirSync(SCAN_DIR, { recursive: true });

/**
 * Find the first second where the page has rendered content. Returns
 * seconds-to-skip (an integer). Falls back to 0 if no frame crosses
 * the threshold (e.g. a very short clip).
 */
function findContentStart(src) {
  // Probe duration first
  const probe = spawnSync(ffmpegPath, ['-i', src], { encoding: 'utf8' });
  const dur = /Duration: (\d+):(\d+):(\d+)/.exec(probe.stderr ?? '');
  const totalSec = dur ? (+dur[1] * 3600 + +dur[2] * 60 + +dur[3]) : 60;

  for (let t = 0; t < totalSec; t++) {
    const frame = join(SCAN_DIR, `f-${t}.png`);
    spawnSync(
      ffmpegPath,
      ['-y', '-ss', String(t), '-i', src, '-frames:v', '1', frame],
      { stdio: ['ignore', 'ignore', 'ignore'] },
    );
    if (!existsSync(frame)) continue;
    const size = statSync(frame).size;
    if (size >= CONTENT_FRAME_THRESHOLD) {
      return Math.max(0, t - 1); // back off 1s so the cut isn't on a hard edge
    }
  }
  return 0;
}

const webms = readdirSync(VIDEOS_DIR)
  .filter((f) => f.endsWith('.webm'))
  .sort();

console.log(`Encoding ${webms.length} .webm → .gif (auto-trim blank prefix, 8 fps × 900 px wide)…\n`);

for (const file of webms) {
  const src = join(VIDEOS_DIR, file);
  const stem = basename(file, extname(file));
  const palette = join('/tmp', `${stem}.png`);
  const out = join(GIFS_DIR, `${stem}.gif`);

  const skip = findContentStart(src);
  process.stdout.write(`→ ${out}  (skip ${skip}s)`);

  const vf = `fps=${TARGET_FPS},scale=${TARGET_WIDTH}:-1:flags=lanczos`;
  const lavfi =
    `fps=${TARGET_FPS},scale=${TARGET_WIDTH}:-1:flags=lanczos [x]; ` +
    `[x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;

  // Pass 1: palette (from the trimmed clip, capped at MAX_DURATION)
  const p1 = spawnSync(
    ffmpegPath,
    [
      '-y', '-ss', String(skip), '-t', String(MAX_DURATION), '-i', src,
      '-vf', `${vf},palettegen=stats_mode=diff`,
      palette,
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );
  if (p1.status !== 0) {
    console.log('  palette failed');
    continue;
  }

  // Pass 2: encode against the palette (same trim window)
  const p2 = spawnSync(
    ffmpegPath,
    [
      '-y', '-ss', String(skip), '-t', String(MAX_DURATION), '-i', src, '-i', palette,
      '-lavfi', lavfi,
      out,
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );
  if (p2.status !== 0) {
    console.log('  encode failed');
    continue;
  }

  const size = statSync(out).size;
  console.log(`  ${(size / 1024).toFixed(0)} KB`);
}

const totalKB = readdirSync(GIFS_DIR)
  .filter((f) => f.endsWith('.gif'))
  .reduce((sum, f) => sum + statSync(join(GIFS_DIR, f)).size / 1024, 0);
console.log(`\nDone. ${webms.length} GIFs · ${totalKB.toFixed(0)} KB total.`);

rmSync(SCAN_DIR, { recursive: true, force: true });
