import {
  Rule, SchematicContext, Tree,
  apply, url, move, mergeWith, MergeStrategy,
} from '@angular-devkit/schematics';
import { ScaffoldOptions } from './schema';

/**
 * Scaffold the Agentic Experience Platform monorepo into the target workspace:
 * `projects/` (the agentic-ui library + the schematics packages), `platform/`
 * (catalog service, Studio, Hub, ops console, matter-management MFE, embed SDK,
 * …), `docs/`, and the workspace config (angular.json, tsconfig, package.json…).
 *
 * The example apps ship SEPARATELY in `@infra-tools/agentic-examples-schematics`
 * — scaffold those into the same workspace to add the demos.
 *
 * The template `files/` are a snapshot of the repo produced by
 * `scripts/populate-templates.mjs` (shared, security-aware snapshotter), which
 * EXCLUDES security-sensitive scripts (IdP/SSO, token/key minting, load tests,
 * DB/RLS scripts, `.env`, keys) and build artefacts — so nothing that would trip
 * a security scanner is shipped.
 *
 * Files are copied verbatim (no EJS templating) to preserve source fidelity.
 */
export function scaffold(options: ScaffoldOptions = {}): Rule {
  return (_tree: Tree, context: SchematicContext): Rule => {
    const rules: Rule[] = [];
    if (options.directory && options.directory !== '.') {
      rules.push(move(options.directory));
    }

    context.logger.info('Scaffolding the Agentic Experience Platform…');

    return mergeWith(
      apply(url('./files'), rules),
      options.overwrite ? MergeStrategy.Overwrite : MergeStrategy.Default,
    );
  };
}
