import { strings } from '@angular-devkit/core';
import { apply, applyTemplates, mergeWith, move, Rule, url } from '@angular-devkit/schematics';
import { getSourceRoot, resolveProject } from '../utils/workspace';

export interface PlaybookSchematicOptions {
  name: string;
  project?: string;
  path: string;
  title: string;
  description: string;
}

export function playbookSchematic(rawOptions: Partial<PlaybookSchematicOptions>): Rule {
  const options: PlaybookSchematicOptions = {
    name: rawOptions.name ?? 'myPlaybook',
    project: rawOptions.project,
    path: rawOptions.path ?? 'app/agentic/playbooks',
    title: rawOptions.title ?? 'My playbook',
    description: rawOptions.description ?? 'Playbook description.',
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
