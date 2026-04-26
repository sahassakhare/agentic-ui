import { strings } from '@angular-devkit/core';
import { apply, applyTemplates, mergeWith, move, Rule, url } from '@angular-devkit/schematics';

export interface AgentServerSchematicOptions {
  name: string;
  directory: string;
  port: number;
}

export function agentServerSchematic(rawOptions: Partial<AgentServerSchematicOptions>): Rule {
  const options: AgentServerSchematicOptions = {
    name: rawOptions.name ?? 'agent-server',
    directory: rawOptions.directory ?? 'projects',
    port: rawOptions.port ?? 4111,
  };
  const template = apply(url('./files'), [
    applyTemplates({ ...strings, ...options }),
    move(`${options.directory}/${options.name}`),
  ]);
  return mergeWith(template);
}
