import { strings } from '@angular-devkit/core';
import { apply, applyTemplates, mergeWith, move, Rule, url } from '@angular-devkit/schematics';
import { getSourceRoot, resolveProject } from '../utils/workspace';

export interface IntentSchematicOptions {
  name: string;
  project?: string;
  path: string;
  description: string;
  kind: 'tool' | 'action' | 'route';
  target: string;
}

export function intentSchematic(rawOptions: Partial<IntentSchematicOptions>): Rule {
  const options: IntentSchematicOptions = {
    name: rawOptions.name ?? 'myIntent',
    project: rawOptions.project,
    path: rawOptions.path ?? 'app/agentic/intents',
    description: rawOptions.description ?? 'Intent description.',
    kind: rawOptions.kind ?? 'tool',
    target: rawOptions.target ?? 'myTool',
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
