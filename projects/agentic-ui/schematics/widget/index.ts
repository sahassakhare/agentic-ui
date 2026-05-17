import { strings } from '@angular-devkit/core';
import { apply, applyTemplates, mergeWith, move, Rule, url } from '@angular-devkit/schematics';
import { getSourceRoot, resolveProject } from '../utils/workspace';

export interface WidgetSchematicOptions {
  name: string;
  project?: string;
  path: string;
  prefix: string;
}

export function widgetSchematic(rawOptions: Partial<WidgetSchematicOptions>): Rule {
  const options: WidgetSchematicOptions = {
    name: rawOptions.name ?? 'MyWidget',
    project: rawOptions.project,
    path: rawOptions.path ?? 'app/agentic/widgets',
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
