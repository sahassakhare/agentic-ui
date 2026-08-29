/**
 * Compile a Studio-authored `kind:'validation'` rule into a field validator.
 *
 * A rule `body.rule` is a boolean expression over `value` (e.g.
 * `value != null && value.length <= 500`); it returns the row's `message` when
 * the expression is falsy, or null when the value passes.
 *
 * Security: the expression is evaluated with `new Function`. Catalog authoring is
 * governed (draft → review → approved), which is the trust boundary; a rule that
 * throws or isn't a valid expression (e.g. an async "service ref") fails open —
 * it never blocks the field — so a bad rule can't wedge a form. A dedicated
 * service-ref / async path is future work.
 */
export type FieldValidator = (value: unknown) => string | null;

export function compileRule(rule: string | undefined, message: string | undefined): FieldValidator {
  const msg = (message && message.trim()) || 'Invalid value';
  if (!rule || !rule.trim()) return () => null;
  let predicate: (value: unknown) => boolean;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function('value', `"use strict"; return !!(${rule});`) as (v: unknown) => boolean;
    predicate = (value) => { try { return fn(value); } catch { return true; } };
  } catch {
    predicate = () => true; // not a compilable expression → no-op (fail open)
  }
  return (value) => (predicate(value) ? null : msg);
}
