import {
  Rule, SchematicContext, Tree,
  apply, url, move, mergeWith, MergeStrategy,
} from '@angular-devkit/schematics';
import { ScaffoldOptions } from './schema';

/**
 * Scaffold the Agentic Experience Platform example apps (`examples/`) into the
 * target workspace. Companion to `@infra-tools/agentic-platform-schematics` —
 * scaffold the platform first, then drop these demos into the same workspace
 * (they consume the platform's workspace config + the agentic-ui library).
 *
 * The template `files/` are a snapshot produced by
 * `scripts/populate-templates.mjs` (the shared, security-aware snapshotter from
 * the platform package), which EXCLUDES security-sensitive scripts (IdP/SSO,
 * token/key minting, load tests, DB/RLS scripts, `.env`, keys) and build
 * artefacts. Files are copied verbatim (no EJS templating) to preserve fidelity.
 */
export function scaffold(options: ScaffoldOptions = {}): Rule {
  return (_tree: Tree, context: SchematicContext): Rule => {
    const rules: Rule[] = [];
    if (options.directory && options.directory !== '.') {
      rules.push(move(options.directory));
    }

    context.logger.info('Scaffolding the Agentic Experience Platform example apps…');

    return mergeWith(
      apply(url('./files'), rules),
      options.overwrite ? MergeStrategy.Overwrite : MergeStrategy.Default,
    );
  };
}
