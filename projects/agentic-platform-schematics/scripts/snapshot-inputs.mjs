/**
 * Single source of truth for WHAT the platform snapshot bundles.
 *
 * Imported by `populate-templates.mjs` (to run the snapshot) AND by the repo
 * drift-guard `scripts/check-schematics-release-paths.mjs` (to verify the
 * `schematics-release.yml` `paths:` filter still covers every input). Keeping
 * the list here — not inline in populate — is what lets the guard prove the
 * release workflow can never silently stop republishing part of the codebase.
 *
 * If you change these inputs, the guard will fail until `schematics-release.yml`
 * `on.push.paths` is updated to match — that's the point.
 */
export const PLATFORM_SNAPSHOT_INPUTS = {
  topDirs: ['projects', 'platform', 'docs'],
  topFiles: ['package.json', 'angular.json', 'README.md', '.editorconfig', '.gitignore', '.prettierrc', 'LICENSE'],
  includeTsconfig: true,
};
