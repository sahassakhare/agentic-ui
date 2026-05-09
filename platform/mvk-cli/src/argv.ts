/**
 * Tiny argv parser. We avoid pulling in commander/yargs to keep the
 * CLI install footprint near-zero (just node + zod).
 *
 * Supported syntax:
 *   --flag value
 *   --flag=value
 *   --boolean   (no value → true)
 *
 * Positional args (anything that doesn't start with `--`) are
 * preserved in order. The dispatcher walks them against the command
 * tree to peel off subcommand verbs — `parseArgs` itself only
 * separates flags from positionals, no semantic interpretation.
 *
 * `subcommands` is filled in by the dispatcher after walking the
 * tree; consumers shouldn't read it directly from `parseArgs`.
 */
export interface ParsedArgs {
  readonly subcommands: readonly string[];
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

const BOOLEAN_FLAGS = new Set([
  'help', 'verbose', 'json', 'quiet', 'force',
  'include-deleted',
]);

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
        i++;
        continue;
      }
      const name = arg.slice(2);
      // Treat known booleans as flags; everything else expects a value.
      if (BOOLEAN_FLAGS.has(name)) {
        flags[name] = true;
        i++;
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[name] = true;
        i++;
      } else {
        flags[name] = next;
        i += 2;
      }
    } else {
      positional.push(arg);
      i++;
    }
  }

  return { subcommands: [], positional, flags };
}
