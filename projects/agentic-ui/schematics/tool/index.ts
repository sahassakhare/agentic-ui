import { strings } from '@angular-devkit/core';
import {
  apply,
  applyTemplates,
  mergeWith,
  move,
  Rule,
  url,
} from '@angular-devkit/schematics';
import { getSourceRoot, resolveProject } from '../utils/workspace';

export interface ToolSchematicOptions {
  name: string;
  project?: string;
  path: string;
  description: string;
  executeIn: 'host' | 'remote';
}

export function toolSchematic(rawOptions: Partial<ToolSchematicOptions>): Rule {
  const options: ToolSchematicOptions = {
    name: rawOptions.name ?? 'myTool',
    project: rawOptions.project,
    path: rawOptions.path ?? 'app/agentic/tools',
    description: rawOptions.description ?? 'Tool description.',
    executeIn: rawOptions.executeIn ?? 'host',
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
