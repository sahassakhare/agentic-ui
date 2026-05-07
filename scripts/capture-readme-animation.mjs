/**
 * Record an animated GIF of the eDiscovery flagship in action.
 *
 * Drives the chat with a deliberately-slowed-down typing pace so the
 * resulting recording is watchable in 5–8 seconds: viewer sees the
 * prompt being typed, the routing banner appearing, the tool-call
 * indicator firing, and the custodian-card materialising.
 *
 * Output:
 *   docs/assets/agentic-ui-in-action.webm  (Playwright record)
 *   docs/assets/agentic-ui-in-action.gif   (final asset embedded in README)
 *
 * Run:
 *   node scripts/capture-readme-animation.mjs
 *
 * Requires the same five services as the README screenshot (:4300 +
 * remotes + :4311 server) plus ffmpeg on PATH for the webm → gif
 * conversion.
 */
import { chromium } from 'playwright';
import { mkdir, rename, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

// Resolve the ffmpeg-static binary path so we don't need ffmpeg on PATH.
// `ffmpeg-static` exports the absolute path of its bundled prebuilt binary.
const ffmpegPath = createRequire(import.meta.url)('ffmpeg-static');

const BASE = process.env.EDIS_BASE_URL ?? 'http://localhost:4300';
const OUT_DIR = 'docs/assets';
const VIDEO_NAME = 'agentic-ui-in-action.webm';
const GIF_NAME = 'agentic-ui-in-action.gif';

async function run() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,         // not 2× — keeps GIF size sane
    recordVideo: {
      dir: OUT_DIR,
      size: { width: 1280, height: 800 },
    },
  });
  const page = await ctx.newPage();

  console.log('→ navigating');
  await page.goto(BASE);
  await page.waitForSelector('mvk-chat-shell', { timeout: 30_000 });
  await page.waitForTimeout(1500);          // initial pause for the viewer

  // Type with delay so the typing itself is part of the animation.
  const composer = page.locator('mvk-chat-shell form.composer input[name="composer"]');
  console.log('→ typing prompt');
  await composer.click();
  await composer.type('Add Sarah Chen (schen@acme.com, Finance) as a custodian', { delay: 35 });
  await page.waitForTimeout(400);

  console.log('→ sending');
  await page.locator('mvk-chat-shell form.composer button[type="submit"]').click();

  // Wait for the widget — the climax of the animation.
  await page.waitForSelector('mvk-chat-shell app-custodian-card', { timeout: 120_000 });
  console.log('→ widget rendered');
  await page.waitForTimeout(1800);          // hold on the result for ~2s

  await ctx.close();
  await browser.close();

  // Playwright names the video by its trace id; rename to a stable filename.
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(OUT_DIR);
  const webmName = files.find((f) => f.endsWith('.webm') && f !== VIDEO_NAME);
  if (webmName) {
    if (existsSync(join(OUT_DIR, VIDEO_NAME))) await rm(join(OUT_DIR, VIDEO_NAME));
    await rename(join(OUT_DIR, webmName), join(OUT_DIR, VIDEO_NAME));
    console.log(`→ saved ${OUT_DIR}/${VIDEO_NAME}`);
  } else {
    throw new Error('Playwright did not produce a .webm — check recordVideo config');
  }

  // Convert to GIF. Use a 12 fps palette-optimised pipeline for size.
  // First pass generates a palette from the video; second pass uses it
  // to dither — much smaller than naive --crf encodings.
  console.log('→ converting webm → gif (palette pass)');
  await sh(ffmpegPath, [
    '-y', '-i', join(OUT_DIR, VIDEO_NAME),
    '-vf', 'fps=12,scale=1100:-1:flags=lanczos,palettegen=stats_mode=diff',
    '/tmp/agentic-palette.png',
  ]);

  console.log('→ converting webm → gif (dither pass)');
  await sh(ffmpegPath, [
    '-y',
    '-i', join(OUT_DIR, VIDEO_NAME),
    '-i', '/tmp/agentic-palette.png',
    '-filter_complex', 'fps=12,scale=1100:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5',
    join(OUT_DIR, GIF_NAME),
  ]);

  console.log(`→ saved ${OUT_DIR}/${GIF_NAME}`);
}

function sh(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`)),
    );
  });
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
