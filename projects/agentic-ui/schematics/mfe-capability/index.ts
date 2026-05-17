import { strings } from '@angular-devkit/core';
import { apply, applyTemplates, mergeWith, move, Rule, url } from '@angular-devkit/schematics';
import { getSourceRoot, resolveProject } from '../utils/workspace';

export interface MfeCapabilitySchematicOptions {
  remoteName: string;
  project?: string;
  path: string;
  version: string;
  federation: 'native' | 'module-federation';
}

export function mfeCapabilitySchematic(rawOptions: Partial<MfeCapabilitySchematicOptions>): Rule {
  const options: MfeCapabilitySchematicOptions = {
    remoteName: rawOptions.remoteName ?? 'remote',
    project: rawOptions.project,
    path: rawOptions.path ?? 'app/capability',
    version: rawOptions.version ?? '1.0.0',
    federation: rawOptions.federation ?? 'native',
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
