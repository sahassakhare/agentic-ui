/**
 * Minimal semver-range matcher used by `RegistryBase.register()` to
 * evaluate `RegistryEntry.requiredHostVersion` (Capability M1 R5 —
 * ADR-014). Supports the common cases without bundling the full
 * `semver` npm package; complex ranges deliberately bail to `false`
 * so callers see a clean "didn't match" instead of silently passing
 * a malformed range.
 *
 * Supported range syntax (in order of precedence):
 *
 * | Range          | Meaning                                              |
 * |---             |---                                                   |
 * | `1.2.3`        | exact match                                          |
 * | `=1.2.3`       | exact match (= prefix)                               |
 * | `^1.2.3`       | compatible: major same, version >= 1.2.3             |
 * | `~1.2.3`       | close: major+minor same, patch >= 3                  |
 * | `>=1.2.3`      | minimum, no upper bound                              |
 * | `>1.2.3`       | strictly greater                                     |
 * | `<2.0.0`       | strictly less                                        |
 * | `<=1.5.0`      | maximum                                              |
 *
 * NOT supported (returns `false` to keep callers safe):
 *  - Compound ranges (`>=1.2.3 <2.0.0`, `^1 || ^2`)
 *  - Pre-releases (`1.2.3-beta.1`)
 *  - Build metadata (`1.2.3+abc`)
 *  - x-ranges (`1.x`, `1.2.x`)
 *  - Tilde with two parts (`~1.2`)
 *  - Whitespace inside the range
 *
 * If a host needs richer matching, they can implement a custom
 * `RegistryEntry.requiredHostVersion` policy at register-time —
 * but for the v1.x runtime, the supported subset above covers
 * every realistic use case (federated remotes pinning to a major;
 * deprecating capabilities below a known patch version).
 */

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function isValidSemver(s: string): boolean {
  return SEMVER_RE.test(s);
}

interface ParsedVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

function parseVersion(v: string): ParsedVersion | null {
  const m = SEMVER_RE.exec(v);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
}

/** -1 if `a < b`, 0 if equal, +1 if `a > b`. */
function compare(a: ParsedVersion, b: ParsedVersion): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

/**
 * Returns `true` when `version` satisfies `range`. See file docstring
 * for supported syntax. Unrecognised range patterns return `false`.
 */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;

  // Strip operator prefix, parse the rest as a version.
  const opMatch = /^(\^|~|>=|<=|>|<|=)?\s*(\d+\.\d+\.\d+)$/.exec(range);
  if (!opMatch) return false;
  const op = opMatch[1] ?? '=';
  const target = parseVersion(opMatch[2] ?? '');
  if (!target) return false;

  switch (op) {
    case '=':
      return compare(v, target) === 0;

    case '^':
      // Compatible-with: major must match; version must be >= target.
      // Note: caret semantics for 0.x.y differ in the full semver spec
      // (treats 0.x as breaking) — we implement the simpler "major
      // must match" rule, which is what most consumers expect.
      return v.major === target.major && compare(v, target) >= 0;

    case '~':
      // Close-to: major + minor must match; patch must be >= target.
      return v.major === target.major
        && v.minor === target.minor
        && v.patch >= target.patch;

    case '>=':
      return compare(v, target) >= 0;

    case '<=':
      return compare(v, target) <= 0;

    case '>':
      return compare(v, target) > 0;

    case '<':
      return compare(v, target) < 0;

    default:
      // Unknown operator — be conservative.
      return false;
  }
}
