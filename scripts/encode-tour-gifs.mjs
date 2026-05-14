#!/usr/bin/env node
/**
 * Re-encode the post-chat-surfaces tour `.webm` files (Playwright
 * recordings) into optimized `.gif` files for inline rendering on
 * github.com. GitHub strips <video> tags but happily renders
 * ![]() image embeds, so the tour markdown uses GIFs for the
 * inline preview and links to the .webm originals for full quality.
 *
 * Usage (from repo root):
 *
 *   # First, make sure the .webm files are fresh:
 *   cd e2e && EDIS_BASE_URL=https://ediscovery-shell.onrender.com \
 *     npx playwright test specs/11-post-chat-surfaces.spec.ts
 *   cd ..
 *
 *   # Then copy the .webm files into docs/assets/videos/ (manually,
 *   # so renames stick) and re-encode:
 *   node scripts/encode-tour-gifs.mjs
 *
 * Uses the bundled @ffmpeg-installer/ffmpeg binary — no system
 * ffmpeg required. Install on demand if missing.
 *
 * Encoding choices:
 *   - 8 fps (slow video; UI walkthroughs don't need 30 fps)
 *   - 900 px wide (HiDPI source → modest output size)
 *   - Two-pass palette: ffmpeg generates a per-clip 256-colour
 *     palette first, then encodes the gif with bayer dithering
 *     against that palette. Smaller files + visibly better than
 *     single-pass gif encoding.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
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

if (!existsSync(VIDEOS_DIR)) {
  console.error(`No ${VIDEOS_DIR} — run the Playwright spec first.`);
  process.exit(1);
}
mkdirSync(GIFS_DIR, { recursive: true });

const webms = readdirSync(VIDEOS_DIR)
  .filter((f) => f.endsWith('.webm'))
  .sort();

console.log(`Found ${webms.length} .webm files. Encoding to .gif at 8 fps × 900 px wide…\n`);

for (const file of webms) {
  const src = join(VIDEOS_DIR, file);
  const stem = basename(file, extname(file));
  const palette = join('/tmp', `${stem}.png`);
  const out = join(GIFS_DIR, `${stem}.gif`);

  console.log(`→ ${out}`);

  // Pass 1: palette
  const p1 = spawnSync(
    ffmpegPath,
    [
      '-y', '-i', src,
      '-vf', 'fps=8,scale=900:-1:flags=lanczos,palettegen=stats_mode=diff',
      palette,
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );
  if (p1.status !== 0) {
    console.error(`   palette pass failed for ${file}`);
    continue;
  }

  // Pass 2: encode
  const p2 = spawnSync(
    ffmpegPath,
    [
      '-y', '-i', src, '-i', palette,
      '-lavfi', 'fps=8,scale=900:-1:flags=lanczos [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
      out,
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  );
  if (p2.status !== 0) {
    console.error(`   encode pass failed for ${file}`);
    continue;
  }

  const size = statSync(out).size;
  console.log(`   ${(size / 1024).toFixed(0)} KB`);
}

const totalKB = readdirSync(GIFS_DIR)
  .filter((f) => f.endsWith('.gif'))
  .reduce((sum, f) => sum + statSync(join(GIFS_DIR, f)).size / 1024, 0);
console.log(`\nDone. ${webms.length} GIFs · ${totalKB.toFixed(0)} KB total.`);
