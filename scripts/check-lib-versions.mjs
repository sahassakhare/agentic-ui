#!/usr/bin/env node
/**
 * Library version-drift guard.
 *
 * `publish.yml` publishes each package at whatever version sits in its
 * package.json, and skips it when that version is already on npm. So a change
 * to a library that forgets to bump the version is silently NOT published — the
 * npm release drifts behind the repo. This guard fails a PR when a publishable
 * package's tracked source changed since the base ref but its package.json
 * `version` did not, so every library change ships.
 *
 * Usage: node scripts/check-lib-versions.mjs [baseRef]
 *   baseRef defaults to origin/$GITHUB_BASE_REF (CI) or `main` (local).
 *
 * Scope: the eight packages the publish workflow actually releases. Spec files
 * and standalone docs don't require a bump (they don't change shipped runtime
 * behaviour) and are ignored.
 */
import { execSync } from 'node:child_process';

/**
 * Packages released by .github/workflows/publish.yml, dir → npm name.
 *
 * The two scaffold schematics — `agentic-platform-schematics` and
 * `agentic-examples-schematics` — are intentionally NOT here: each embeds a
 * build-time snapshot of the repo (gitignored), so a manual per-PR bump can't
 * track its real staleness. They are auto-versioned + published on every
 * qualifying merge by .github/workflows/{schematics-release,
 * examples-schematics-release}.yml (npm is their version-of-record), which makes
 * the manual-bump guard redundant for them.
 */
const PACKAGES = [
  ['projects/agentic-ui', '@infra-tools/agentic-ui'],
  ['projects/agentic-ui-server', '@infra-tools/agentic-ui-server'],
  ['projects/agentic-ui-mcp', '@infra-tools/agentic-ui-mcp'],
  ['projects/agentic-ui-opa-authorizer', '@infra-tools/agentic-ui-opa-authorizer'],
  ['platform/agentic-catalog-server', '@infra-tools/agentic-catalog-server'],
  ['platform/aep-embed-sdk', '@infra-tools/aep-embed-sdk'],
  ['platform/mvk-cli', '@infra-tools/mvk'],
];

/** Changes that don't alter shipped runtime behaviour — no bump required. */
const IGNORE = /(\.spec\.ts|\.test\.ts|\/__tests__\/|\.md$)$/;

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function resolveBase(argv) {
  if (argv[2]) return argv[2];
  if (process.env.GITHUB_BASE_REF) return `origin/${process.env.GITHUB_BASE_REF}`;
  return 'main';
}

function versionAt(ref, dir) {
  try {
    return JSON.parse(sh(`git show ${ref}:${dir}/package.json`)).version;
  } catch {
    return null; // package didn't exist at that ref → treat as new
  }
}

const base = resolveBase(process.argv);
let mergeBase;
try {
  mergeBase = sh(`git merge-base ${base} HEAD`);
} catch {
  console.error(`✖ Cannot resolve base ref "${base}". Fetch it, or pass one: node scripts/check-lib-versions.mjs <ref>`);
  process.exit(2);
}

const violations = [];
for (const [dir, name] of PACKAGES) {
  const changed = sh(`git diff --name-only ${mergeBase}...HEAD -- ${dir}`)
    .split('\n')
    .filter(Boolean)
    .filter((f) => !IGNORE.test(f));
  if (changed.length === 0) continue;

  const baseV = versionAt(mergeBase, dir);
  const headV = versionAt('HEAD', dir);
  if (baseV !== null && baseV === headV) {
    violations.push({ name, dir, version: headV, files: changed.length });
  }
}

if (violations.length === 0) {
  console.log('✓ Library version guard: every changed publishable package has a version bump (or nothing library-side changed).');
  process.exit(0);
}

console.error('✖ Library version guard failed — these packages changed but their version was not bumped:\n');
for (const v of violations) {
  console.error(`  • ${v.name}  (${v.dir})  still at ${v.version} — ${v.files} changed file(s)`);
}
console.error('\nBump each package.json "version" so publish.yml releases the change (npm skips versions already published).');
process.exit(1);
