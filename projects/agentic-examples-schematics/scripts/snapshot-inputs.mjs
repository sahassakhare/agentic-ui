/**
 * Single source of truth for WHAT the examples snapshot bundles — the companion
 * to the platform package (scaffold that first, then these demos into the same
 * workspace). Imported by `populate-templates.mjs` AND the repo drift-guard
 * `scripts/check-schematics-release-paths.mjs`, which verifies
 * `examples-schematics-release.yml` `paths:` still covers every input.
 *
 * If you change these inputs, the guard fails until the release workflow's
 * `on.push.paths` is updated to match.
 */
export const EXAMPLES_SNAPSHOT_INPUTS = {
  topDirs: ['examples'],
  topFiles: [], // companion package — root workspace config comes from the platform scaffold
  includeTsconfig: false,
};
