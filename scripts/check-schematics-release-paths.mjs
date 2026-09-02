/**
 * Drift-guard: prove each schematics-release workflow's `paths:` filter still
 * covers EVERY input its snapshot bundles.
 *
 * WHY: `@infra-tools/agentic-platform-schematics` (and its examples companion)
 * embed a build-time snapshot of the repo. Each release workflow only fires on
 * a hand-maintained `on.push.paths` allow-list. If someone adds a top-level dir
 * to a snapshot's inputs (snapshot-inputs.mjs) but forgets the matching
 * `<dir>/**` in the workflow, a change there would silently stop republishing —
 * the published schematic goes stale without any signal. This check fails CI
 * the moment the two drift apart, so "the published schematics always scaffolds
 * the latest codebase" stays true by construction.
 *
 * It only asserts COVERAGE (workflow paths ⊇ snapshot inputs); a workflow may
 * list extra paths (e.g. its own file, the shared walker) — that's fine.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLATFORM_SNAPSHOT_INPUTS } from '../projects/agentic-platform-schematics/scripts/snapshot-inputs.mjs';
import { EXAMPLES_SNAPSHOT_INPUTS } from '../projects/agentic-examples-schematics/scripts/snapshot-inputs.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Extract the quoted glob entries under the first `paths:` block of a push trigger. */
function parsePaths(yaml) {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => /^\s*paths:\s*$/.test(l));
  if (start === -1) return [];
  const indent = lines[start].match(/^\s*/)[0].length;
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '' || l.trim().startsWith('#')) continue;
    const ind = l.match(/^\s*/)[0].length;
    if (ind <= indent) break; // dedented out of the paths block
    const m = l.match(/^\s*-\s*['"]?([^'"#]+?)['"]?\s*(#.*)?$/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

/** Every input the snapshot needs, as the workflow path glob that must cover it. */
function requiredGlobs({ topDirs, topFiles, includeTsconfig }) {
  const globs = topDirs.map((d) => `${d}/**`).concat(topFiles);
  if (includeTsconfig) globs.push('tsconfig*.json');
  return globs;
}

const targets = [
  { name: 'platform', workflow: '.github/workflows/schematics-release.yml', inputs: PLATFORM_SNAPSHOT_INPUTS },
  { name: 'examples', workflow: '.github/workflows/examples-schematics-release.yml', inputs: EXAMPLES_SNAPSHOT_INPUTS },
];

let failed = false;
for (const t of targets) {
  const yaml = await readFile(path.join(REPO, t.workflow), 'utf8');
  const declared = new Set(parsePaths(yaml));
  const missing = requiredGlobs(t.inputs).filter((g) => !declared.has(g));
  if (missing.length) {
    failed = true;
    console.error(`✗ ${t.name}: ${t.workflow} is missing paths for snapshot inputs: ${missing.join(', ')}`);
    console.error(`  → add each to on.push.paths, or the published schematic will go stale when those change.`);
  } else {
    console.log(`✓ ${t.name}: ${t.workflow} paths cover all ${requiredGlobs(t.inputs).length} snapshot input(s)`);
  }
}

if (failed) process.exit(1);
console.log('✓ schematics-release workflows cover every snapshot input — republish-on-latest is guaranteed');
