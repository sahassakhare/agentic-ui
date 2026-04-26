import { strings } from '@angular-devkit/core';
import { apply, applyTemplates, mergeWith, move, Rule, url } from '@angular-devkit/schematics';
import { getSourceRoot, resolveProject } from '../utils/workspace';

export interface ChatShellSchematicOptions {
  name: string;
  project?: string;
  path: string;
  prefix: string;
}

export function chatShellSchematic(rawOptions: Partial<ChatShellSchematicOptions>): Rule {
  const options: ChatShellSchematicOptions = {
    name: rawOptions.name ?? 'Chat',
    project: rawOptions.project,
    path: rawOptions.path ?? 'app/chat',
    prefix: rawOptions.prefix ?? 'app',
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
