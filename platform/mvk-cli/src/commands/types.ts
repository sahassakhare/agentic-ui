import type { CatalogClient } from '../catalog-client.js';
import type { CliConfig } from '../config.js';
import type { ParsedArgs } from '../argv.js';

export interface CommandContext {
  readonly client: CatalogClient;
  readonly config: CliConfig;
  readonly args: ParsedArgs;
  readonly stdin?: NodeJS.ReadStream;
}

export interface Command {
  readonly description: string;
  readonly usage?: string;
  run(ctx: CommandContext): Promise<number>;
}

export interface CommandTree {
  [key: string]: Command | CommandTree;
}

export function isCommand(node: Command | CommandTree): node is Command {
  return typeof (node as Command).run === 'function';
}
