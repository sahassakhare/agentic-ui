import { strings } from '@angular-devkit/core';
import { apply, applyTemplates, mergeWith, move, Rule, url } from '@angular-devkit/schematics';
import { getSourceRoot, resolveProject } from '../utils/workspace';

export interface TriggerSchematicOptions {
  name: string;
  project?: string;
  path: string;
  description: string;
  /** ADR-045 D2 — discriminator for the spec/target shape. */
  kind: 'cron' | 'webhook' | 'queue';
  /** Cron expression / webhook path / queue topic depending on `kind`. */
  spec: string;
  /** Where the trigger dispatches when it fires. */
  targetKind: 'tool' | 'action' | 'notification';
  /** Tool name / action name when `targetKind` is one of those. */
  target: string;
  /** Persona id used for audit attribution + scope. */
  runAs?: string;
}

export function triggerSchematic(rawOptions: Partial<TriggerSchematicOptions>): Rule {
  const options: TriggerSchematicOptions = {
    name: rawOptions.name ?? 'myTrigger',
    project: rawOptions.project,
    path: rawOptions.path ?? 'app/agentic/triggers',
    description: rawOptions.description ?? 'Trigger description.',
    kind: rawOptions.kind ?? 'cron',
    spec: rawOptions.spec ?? '@daily',
    targetKind: rawOptions.targetKind ?? 'tool',
    target: rawOptions.target ?? 'myTool',
    runAs: rawOptions.runAs,
  };
  return (host) => {
    const { project } = resolveProject(host, options.project);
    const sourceRoot = getSourceRoot(project);
    const template = apply(url('./files'), [
      applyTemplates({ ...strings, ...options, runAsLiteral: options.runAs ? `'${options.runAs}'` : 'undefined' }),
      move(`${sourceRoot}/${options.path}`),
    ]);
    return mergeWith(template);
  };
}
