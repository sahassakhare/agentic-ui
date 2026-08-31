/**
 * Snapshot the PLATFORM repo (projects/, platform/, docs/ + workspace config)
 * into this schematic's template `files/`, so the scaffold schematic can
 * regenerate the platform monorepo. Runs at build/publish time — the snapshot is
 * NOT committed (see .gitignore).
 *
 * Example apps ship SEPARATELY in @infra-tools/agentic-examples-schematics; this
 * package no longer snapshots examples/. The security-aware walker + exclusion
 * list live in ./snapshot-repo.mjs (shared with the examples package).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotRepo } from './snapshot-repo.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { copied, excludedSecurity } = await snapshotRepo({
  pkgDir: PKG,
  topDirs: ['projects', 'platform', 'docs'],
  topFiles: ['package.json', 'angular.json', 'README.md', '.editorconfig', '.gitignore', '.prettierrc', 'LICENSE'],
  includeTsconfig: true,
});

console.log(`✓ Platform snapshot complete: ${copied} files copied into files/`);
console.log(`✓ Excluded ${excludedSecurity.length} security-sensitive item(s) (see EXCLUDED.md):`);
for (const f of excludedSecurity.sort().slice(0, 40)) console.log('   -', f);
if (excludedSecurity.length > 40) console.log(`   … +${excludedSecurity.length - 40} more`);
