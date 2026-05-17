import { Tree, SchematicsException } from '@angular-devkit/schematics';

const PROVIDERS_REGEX = /providers\s*:\s*\[([\s\S]*?)\]/;

/**
 * Patches a standalone Angular app's `app.config.ts` to add a list of
 * providers and the matching imports. Idempotent — already-present imports
 * and providers are not duplicated.
 */
export function patchAppConfig(
  host: Tree,
  configPath: string,
  imports: ReadonlyArray<{ readonly symbols: readonly string[]; readonly module: string }>,
  providerExpressions: readonly string[],
): void {
  const buf = host.read(configPath);
  if (!buf) throw new SchematicsException(`Cannot patch ${configPath}: file not found.`);
  let source = buf.toString('utf-8');

  for (const imp of imports) {
    const importLine = `import { ${imp.symbols.join(', ')} } from '${imp.module}';`;
    if (!source.includes(importLine)) {
      // Insert after the last existing import.
      const importPattern = /(import\s.+from\s+['"][^'"]+['"];?\s*\n)+/;
      const match = source.match(importPattern);
      if (match) {
        const insertAt = match.index! + match[0].length;
        source = source.slice(0, insertAt) + importLine + '\n' + source.slice(insertAt);
      } else {
        source = importLine + '\n' + source;
      }
    }
  }

  const m = source.match(PROVIDERS_REGEX);
  if (!m) {
    throw new SchematicsException(`Could not locate \`providers: [...]\` in ${configPath}.`);
  }
  const inner = m[1] ?? '';
  let updated = inner;
  for (const expr of providerExpressions) {
    if (!inner.includes(expr.split('(')[0]!)) {
      const trimmed = updated.trim();
      const sep = trimmed.length === 0 ? '\n    ' : ',\n    ';
      const prefix = trimmed.length === 0 ? '\n    ' : updated.replace(/[\s,]*$/, '') + sep;
      updated = prefix + expr + ',\n  ';
    }
  }
  if (updated !== inner) {
    source = source.replace(PROVIDERS_REGEX, `providers: [${updated}]`);
  }

  host.overwrite(configPath, source);
}
