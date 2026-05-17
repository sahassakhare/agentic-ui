import { strings } from '@angular-devkit/core';
import { apply, applyTemplates, mergeWith, move, Rule, url } from '@angular-devkit/schematics';
import { getSourceRoot, resolveProject } from '../utils/workspace';

export interface ActionSchematicOptions {
  name: string;
  project?: string;
  path: string;
  description: string;
}

export function actionSchematic(rawOptions: Partial<ActionSchematicOptions>): Rule {
  const options: ActionSchematicOptions = {
    name: rawOptions.name ?? 'myAction',
    project: rawOptions.project,
    path: rawOptions.path ?? 'app/agentic/actions',
    description: rawOptions.description ?? 'Action description.',
  };
  return (host) => {
    const { project } = resolveProject(host, options.project);
    const sourceRoot = getSourceRoot(project);
    const template = apply(url('./files'), [
      applyTemplates({ ...strings, ...options }),
      move(`${sourceRoot}/${options.path}`),
    ]);
    return mergeWith(template);
  };
}
