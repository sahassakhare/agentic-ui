import { strings } from '@angular-devkit/core';
import { apply, applyTemplates, mergeWith, move, Rule, url } from '@angular-devkit/schematics';
import { getSourceRoot, resolveProject } from '../utils/workspace';

export interface FormSchematicOptions {
  name: string;
  project?: string;
  path: string;
  description: string;
}

export function formSchematic(rawOptions: Partial<FormSchematicOptions>): Rule {
  const options: FormSchematicOptions = {
    name: rawOptions.name ?? 'myForm',
    project: rawOptions.project,
    path: rawOptions.path ?? 'app/agentic/forms',
    description: rawOptions.description ?? 'Form description.',
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
