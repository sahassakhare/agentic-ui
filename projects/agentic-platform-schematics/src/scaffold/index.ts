import {
  Rule, SchematicContext, Tree,
  apply, url, move, filter, mergeWith, MergeStrategy,
} from '@angular-devkit/schematics';
import { ScaffoldOptions } from './schema';

/**
 * Scaffold the entire Agentic Experience Platform monorepo into the target
 * workspace: `projects/` (the agentic-ui library + this schematics package),
 * `platform/` (catalog service, Studio, Hub, ops console, matter-management MFE,
 * embed SDK, …), `examples/`, and the workspace config (angular.json, tsconfig,
 * package.json, …).
 *
 * The template `files/` are a snapshot of the repo produced by
 * `scripts/populate-templates.mjs`, which EXCLUDES security-sensitive scripts
 * (IdP/SSO, token/key minting, load tests, DB/RLS scripts, `.env`, keys) and
 * build artefacts — so nothing that would trip a security scanner is shipped.
 *
 * Files are copied verbatim (no EJS templating) to preserve source fidelity.
 */
export function scaffold(options: ScaffoldOptions = {}): Rule {
  return (_tree: Tree, context: SchematicContext): Rule => {
    const rules: Rule[] = [];
    if (options.includeExamples === false) {
      rules.push(filter((path) => !path.startsWith('/examples/')));
    }
    if (options.directory && options.directory !== '.') {
      rules.push(move(options.directory));
    }

    context.logger.info(
      `Scaffolding the Agentic Experience Platform${options.includeExamples === false ? ' (without examples)' : ''}…`,
    );

    return mergeWith(
      apply(url('./files'), rules),
      options.overwrite ? MergeStrategy.Overwrite : MergeStrategy.Default,
    );
  };
}
