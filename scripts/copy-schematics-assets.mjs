#!/usr/bin/env node
/**
 * Post-tsc step: copies schematic non-TS assets (collection.json, schema.json,
 * files/** templates) into dist/agentic-ui/schematics/ so the published lib
 * has a complete schematics collection.
 */
import { cp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'projects/agentic-ui/schematics');
const DEST = path.join(ROOT, 'dist/agentic-ui/schematics');

if (!existsSync(SRC)) {
  console.error(`[copy-schematics-assets] Missing source: ${SRC}`);
  process.exit(1);
}

await mkdir(DEST, { recursive: true });

await cp(SRC, DEST, {
  recursive: true,
  filter: (file) => !file.endsWith('.ts') && !file.endsWith('tsconfig.json'),
});

console.log(`[copy-schematics-assets] Copied non-TS assets from ${path.relative(ROOT, SRC)} → ${path.relative(ROOT, DEST)}`);
