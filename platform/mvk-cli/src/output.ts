/**
 * Small output helpers — JSON or table-formatted to stdout depending
 * on the caller's `--json` flag preference.
 */

export interface OutputOptions {
  readonly json?: boolean;
  readonly quiet?: boolean;
}

export function emit(value: unknown, opts: OutputOptions = {}): void {
  if (opts.quiet) return;
  if (opts.json) {
    process.stdout.write(JSON.stringify(value, null, 2) + '\n');
    return;
  }
  if (typeof value === 'string') {
    process.stdout.write(value + '\n');
    return;
  }
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

export function emitTable<T extends object>(
  rows: readonly T[],
  columns: readonly { header: string; pick: (row: T) => string | number | null | undefined }[],
  opts: OutputOptions = {},
): void {
  if (opts.quiet) return;
  if (opts.json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    return;
  }
  if (rows.length === 0) {
    process.stdout.write('(no rows)\n');
    return;
  }
  const widths = columns.map((c) => c.header.length);
  const rendered = rows.map((row) => {
    return columns.map((c, i) => {
      const v = c.pick(row);
      const s = v == null ? '—' : String(v);
      if (s.length > widths[i]!) widths[i] = s.length;
      return s;
    });
  });
  const header = columns.map((c, i) => c.header.padEnd(widths[i]!)).join('  ');
  const sep = widths.map((w) => '─'.repeat(w)).join('  ');
  process.stdout.write(header + '\n');
  process.stdout.write(sep + '\n');
  for (const row of rendered) {
    process.stdout.write(row.map((s, i) => s.padEnd(widths[i]!)).join('  ') + '\n');
  }
}

export function emitError(err: unknown, opts: OutputOptions = {}): void {
  const msg = err instanceof Error ? err.message : String(err);
  if (opts.json) {
    process.stderr.write(JSON.stringify({ error: msg }, null, 2) + '\n');
  } else {
    process.stderr.write(`mvk: ${msg}\n`);
  }
}
