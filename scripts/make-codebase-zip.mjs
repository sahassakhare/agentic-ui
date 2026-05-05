#!/usr/bin/env node
/**
 * Build an email-friendly zip of the codebase, written to
 * docs/distributions/agentic-ui-codebase.zip. Use when you need to send
 * the whole repo through corporate email filters that block source-code
 * extensions.
 *
 *  · Honours .gitignore (uses `git ls-files` for the source list)
 *  · Each file gets a trailing `.txt` (`package.json` -> `package.json.txt`)
 *    so anti-malware filters pass it through
 *  · Skips large binary visual artefacts (.pptx / .png / .gif / .webm /
 *    .jpg / .ico / .woff / .ttf / .mp4 / .mov / .zip)
 *  · Uses ZIP_DEFLATED level 9 — typical 5x compression on a TS/JSON repo
 *
 * Run:
 *   node scripts/make-codebase-zip.mjs
 *
 * The unzip recipient must strip the `.txt` suffix to restore originals:
 *   unzip agentic-ui-codebase.zip
 *   cd agentic-ui-codebase
 *   find . -type f -name '*.txt' -exec sh -c 'mv "$0" "${0%.txt}"' {} \;
 */
import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, stat, rm } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT_DIR = resolve(REPO_ROOT, 'docs/distributions');
const OUT_ZIP = resolve(OUT_DIR, 'agentic-ui-codebase.zip');

const SKIP_EXTS = new Set([
  '.pptx', '.png', '.gif', '.webm', '.jpg', '.jpeg',
  '.ico', '.icns', '.woff', '.woff2', '.ttf', '.eot',
  '.mp4', '.mov', '.zip',
]);

// archiver isn't a default workspace dep — install on demand.
async function loadArchiver() {
  const require = createRequire(import.meta.url);
  try {
    return require('archiver');
  } catch {
    console.log('→ installing archiver (one-off)');
    execFileSync('npm', ['install', '--no-save', 'archiver'], {
      stdio: 'inherit',
      cwd: REPO_ROOT,
    });
    return require('archiver');
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await rm(OUT_ZIP, { force: true });

  const list = execFileSync('git', ['-C', REPO_ROOT, 'ls-files'], {
    encoding: 'utf-8',
  })
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`tracked files in repo: ${list.length}`);

  const archiver = await loadArchiver();
  const archive = archiver('zip', { zlib: { level: 9 } });
  const out = createWriteStream(OUT_ZIP);
  const done = new Promise((res, rej) => {
    out.on('close', res);
    archive.on('error', rej);
  });
  archive.pipe(out);

  let added = 0;
  let skipped = 0;
  const skippedByExt = {};

  for (const rel of list) {
    const ext = extname(rel).toLowerCase();
    if (SKIP_EXTS.has(ext)) {
      skipped++;
      skippedByExt[ext] = (skippedByExt[ext] ?? 0) + 1;
      continue;
    }
    const abs = resolve(REPO_ROOT, rel);
    try {
      const s = await stat(abs);
      if (!s.isFile()) continue;
    } catch {
      continue;
    }
    archive.file(abs, { name: `agentic-ui-codebase/${rel}.txt` });
    added++;
  }

  await archive.finalize();
  await done;

  const sz = (await stat(OUT_ZIP)).size;
  console.log(`\nzip:     ${OUT_ZIP}`);
  console.log(`size:    ${(sz / 1_000_000).toFixed(2)} MB`);
  console.log(`added:   ${added} files (each as <name>.txt)`);
  console.log(`skipped: ${skipped} large/binary files`);

  if (skipped) {
    console.log('\nskipped extensions breakdown:');
    for (const [ext, n] of Object.entries(skippedByExt).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${ext}: ${n}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
