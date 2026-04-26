#!/usr/bin/env node
/**
 * Compodoc's `includes` directive expects a flat folder of .md files plus a
 * summary.json. The repo's canonical cookbook lives in docs/cookbook/ —
 * this script syncs from there so the includes folder is a build artefact,
 * not duplicated content.
 *
 * Tracked in git: scripts/prepare-compodoc-includes.mjs and
 *                docs/compodoc-includes/summary.json
 * Build outputs: docs/compodoc-includes/*.md (gitignored)
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const cookbookDir = resolve(root, 'docs/cookbook');
const outDir = resolve(root, 'docs/compodoc-includes');
const summaryPath = resolve(outDir, 'summary.json');

mkdirSync(outDir, { recursive: true });

const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
let copied = 0;
for (const entry of summary) {
  if (typeof entry?.file !== 'string') continue;
  const src = resolve(cookbookDir, entry.file);
  const dst = resolve(outDir, entry.file);
  copyFileSync(src, dst);
  copied++;
}
console.log(`prepare-compodoc-includes: synced ${copied} cookbook entr${copied === 1 ? 'y' : 'ies'} → docs/compodoc-includes/`);
