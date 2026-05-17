import { JsonValue } from '@angular-devkit/core';
import { Tree, SchematicsException } from '@angular-devkit/schematics';

export interface WorkspaceProject {
  readonly projectType?: 'application' | 'library';
  readonly root?: string;
  readonly sourceRoot?: string;
  readonly prefix?: string;
}

export interface WorkspaceJson {
  readonly projects?: Record<string, WorkspaceProject>;
  readonly defaultProject?: string;
}

export function readWorkspace(host: Tree): WorkspaceJson {
  const buffer = host.read('angular.json') ?? host.read('workspace.json');
  if (!buffer) throw new SchematicsException('No angular.json or workspace.json found at the workspace root.');
  return JSON.parse(buffer.toString('utf-8')) as WorkspaceJson;
}

export function resolveProject(host: Tree, requested: string | undefined): { name: string; project: WorkspaceProject } {
  const ws = readWorkspace(host);
  const projects = ws.projects ?? {};
  const name = requested ?? ws.defaultProject ?? Object.keys(projects)[0];
  if (!name || !projects[name]) {
    throw new SchematicsException(
      `Could not resolve target project. Pass --project=<name>. Available: ${Object.keys(projects).join(', ') || '(none)'}.`,
    );
  }
  return { name, project: projects[name] };
}

export function getSourceRoot(project: WorkspaceProject): string {
  return project.sourceRoot ?? (project.root ? `${project.root}/src` : 'src');
}

export function readJson<T = JsonValue>(host: Tree, path: string): T {
  const buf = host.read(path);
  if (!buf) throw new SchematicsException(`File not found: ${path}`);
  return JSON.parse(buf.toString('utf-8')) as T;
}

export function writeJson(host: Tree, path: string, value: unknown): void {
  const text = JSON.stringify(value, null, 2) + '\n';
  if (host.exists(path)) host.overwrite(path, text);
  else host.create(path, text);
}
