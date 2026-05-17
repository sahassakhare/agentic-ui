/**
 * Single source of truth for custodian-intake field options shared
 * across surfaces. Used by:
 *   - `IntakeIdentityComponent` (F1 composition form, used by chat /
 *     direct page / Cmd+K palette via the openCustodianIntake tool),
 *   - `normaliseDynamicSchema` in agentic.ts (post-processes the
 *     LLM-emitted form schema before mounting in `DynamicFormCard`),
 *   - and any future surface that needs department options.
 *
 * Keeping the list here -- not duplicated in each surface -- means
 * the demo enforces consistent department wording across triggers.
 * Add new departments here; they show up everywhere.
 */
export const STANDARD_DEPARTMENTS = [
  'Engineering',
  'Finance',
  'Legal',
  'Marketing',
  'Operations',
  'Sales',
  'HR',
] as const;

export type StandardDepartment = typeof STANDARD_DEPARTMENTS[number];

/**
 * Map a free-text department (from chat extraction, URL params,
 * or the LLM tool args) onto the canonical STANDARD_DEPARTMENTS
 * list. Case-insensitive; matches on full equality first, then
 * prefix, so "finance team" still maps to "Finance". Returns ''
 * when nothing matches so dropdowns stay unselected and form
 * predicates evaluate to "no department".
 */
export function normaliseDepartment(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (!v) return '';
  return (
    STANDARD_DEPARTMENTS.find((d) => d.toLowerCase() === v)
    ?? STANDARD_DEPARTMENTS.find((d) => v.startsWith(d.toLowerCase()))
    ?? ''
  );
}
