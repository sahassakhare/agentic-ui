import { strings } from '@angular-devkit/core';
import { apply, applyTemplates, mergeWith, move, Rule, url } from '@angular-devkit/schematics';
import { getSourceRoot, resolveProject } from '../utils/workspace';

export interface DashboardSchematicOptions {
  name: string;
  project?: string;
  path: string;
  title: string;
  description: string;
  /** Inline layout name resolved via LayoutRegistry. */
  layout: string;
}

export function dashboardSchematic(rawOptions: Partial<DashboardSchematicOptions>): Rule {
  const options: DashboardSchematicOptions = {
    name: rawOptions.name ?? 'myDashboard',
    project: rawOptions.project,
    path: rawOptions.path ?? 'app/agentic/dashboards',
    title: rawOptions.title ?? 'My dashboard',
    description: rawOptions.description ?? 'Dashboard description.',
    layout: rawOptions.layout ?? 'two-col',
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
