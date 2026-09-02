/**
 * Snapshot the `examples/` apps into this schematic's template `files/`, so the
 * scaffold schematic can regenerate the example apps + MFE remotes. Runs at
 * build/publish time — the snapshot is NOT committed (see .gitignore).
 *
 * Companion to @infra-tools/agentic-platform-schematics (the platform itself):
 * scaffold that first, then these demos into the same workspace. The
 * security-aware walker + exclusion list are SHARED from the platform package
 * (single source of truth) — see ../../agentic-platform-schematics/scripts/snapshot-repo.mjs.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotRepo } from '../../agentic-platform-schematics/scripts/snapshot-repo.mjs';
import { EXAMPLES_SNAPSHOT_INPUTS } from './snapshot-inputs.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { copied, excludedSecurity } = await snapshotRepo({ pkgDir: PKG, ...EXAMPLES_SNAPSHOT_INPUTS });

console.log(`✓ Examples snapshot complete: ${copied} files copied into files/`);
console.log(`✓ Excluded ${excludedSecurity.length} security-sensitive item(s) (see EXCLUDED.md):`);
for (const f of excludedSecurity.sort().slice(0, 40)) console.log('   -', f);
if (excludedSecurity.length > 40) console.log(`   … +${excludedSecurity.length - 40} more`);
