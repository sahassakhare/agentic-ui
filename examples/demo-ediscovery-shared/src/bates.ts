/**
 * Bates numbering — the eDiscovery convention for stable, unique
 * identifiers stamped on every page of a produced document. Each
 * production set declares a *pattern* with a `{seq:Nd}` placeholder
 * (e.g. `ACME-{seq:07d}`) and the ids are filled in left-padded with
 * zeros, in the order the production-set's documents are listed.
 *
 * @remarks
 * The format is borrowed from Python's `format()` mini-language to
 * stay readable in tool prompts ("use `ACME-{seq:07d}` for seven-
 * digit zero-padded numbers"). Real eDiscovery vendors layer in
 * matter-specific prefixes, branch numbers, page-suffix conventions
 * (e.g. `ACME-0000001.0001` per page) — out of scope for the demo.
 */

const PATTERN_RE = /^([A-Z][A-Z0-9_-]*?)-\{seq:(\d+)d\}$/;

/**
 * Result of validating a Bates pattern. When `ok` is true, `prefix`
 * and `width` describe the parsed parts. When false, `errors` lists
 * human-readable problems for the agent to surface.
 */
export type BatesValidation =
  | { ok: true; prefix: string; width: number }
  | { ok: false; errors: readonly string[] };

/**
 * Validate that a Bates pattern conforms to the demo's convention.
 *
 * @example
 * ```ts
 * validateBatesPattern('ACME-{seq:07d}')
 * // → { ok: true, prefix: 'ACME', width: 7 }
 *
 * validateBatesPattern('acme_{seq:5d}')
 * // → { ok: false, errors: ['Prefix must be uppercase ASCII (A-Z, 0-9, -, _)'] }
 * ```
 */
export function validateBatesPattern(pattern: string): BatesValidation {
  const errors: string[] = [];
  if (!pattern.includes('{seq:')) {
    errors.push("Pattern must include the `{seq:Nd}` placeholder (e.g. 'ACME-{seq:07d}')");
  }
  const match = PATTERN_RE.exec(pattern);
  if (!match) {
    if (!/^[A-Z]/.test(pattern)) {
      errors.push('Prefix must be uppercase ASCII (A-Z, 0-9, -, _)');
    }
    if (!/-\{seq:\d+d\}$/.test(pattern)) {
      errors.push('Pattern must end in `-{seq:Nd}` where N is the digit width');
    }
    return { ok: false, errors: errors.length ? errors : ['Pattern does not parse'] };
  }
  const prefix = match[1]!;
  const width = Number(match[2]!);
  if (width < 4 || width > 10) {
    errors.push(`Sequence width must be between 4 and 10 (got ${width})`);
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, prefix, width };
}

/**
 * Format a single Bates id from a pattern + sequence number.
 * Returns `null` when the pattern is invalid.
 *
 * @example formatBates('ACME-{seq:07d}', 1) === 'ACME-0000001'
 */
export function formatBates(pattern: string, seq: number): string | null {
  const v = validateBatesPattern(pattern);
  if (!v.ok) return null;
  return `${v.prefix}-${String(seq).padStart(v.width, '0')}`;
}

/**
 * Generate the full sequence of Bates ids for a production set.
 *
 * @example
 * generateBatesRange('ACME-{seq:07d}', 1, 3)
 * // → ['ACME-0000001', 'ACME-0000002', 'ACME-0000003']
 */
export function generateBatesRange(
  pattern: string,
  start: number,
  count: number,
): readonly string[] {
  const v = validateBatesPattern(pattern);
  if (!v.ok) return [];
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(`${v.prefix}-${String(start + i).padStart(v.width, '0')}`);
  }
  return out;
}

/** Generate the next stable production-set id. Mirrors `nextLegalHoldId` etc. */
export function nextProductionSetId(): string {
  return `PROD-${Math.random().toString(36).slice(2, 5).toUpperCase()}${Date.now().toString(36).slice(-3)}`;
}
