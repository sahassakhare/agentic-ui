import { strings } from '@angular-devkit/core';
import { apply, applyTemplates, mergeWith, move, Rule, url } from '@angular-devkit/schematics';
import { getSourceRoot, resolveProject } from '../utils/workspace';

export interface BackendSchematicOptions {
  name: string;
  project?: string;
  path: string;
}

export function backendSchematic(rawOptions: Partial<BackendSchematicOptions>): Rule {
  const options: BackendSchematicOptions = {
    name: rawOptions.name ?? 'CustomBackend',
    project: rawOptions.project,
    path: rawOptions.path ?? 'app/agentic/backends',
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
