import type { CapabilityRequirement } from './services/experience-catalog.service';

/**
 * Parses a human-friendly requirements textarea into
 * {@link CapabilityRequirement}s for an Experience's `body.requires`.
 *
 * One requirement per line: `kind selector [optional]`
 * - `form customerSearch`        → { kind: 'form', name: 'customerSearch' }
 * - `component #result-card`     → { kind: 'component', tag: 'result-card' }  (late binding)
 * - `tool aiSummary optional`    → { kind: 'tool', name: 'aiSummary', optional: true }
 *
 * Blank lines and lines starting with `#` (comments) are ignored. Malformed
 * lines (missing selector) are skipped rather than throwing, so a half-typed
 * textarea never breaks the form.
 */
export function parseRequirementLines(text: string): CapabilityRequirement[] {
  const out: CapabilityRequirement[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;

    const parts = line.split(/\s+/);
    const kind = parts[0];
    const selector = parts[1];
    if (!kind || !selector) continue;

    const optional = parts.slice(2).some((p) => p.toLowerCase() === 'optional');
    if (selector.startsWith('#')) {
      const tag = selector.slice(1);
      if (tag) out.push({ kind, tag, ...(optional ? { optional } : {}) });
    } else {
      out.push({ kind, name: selector, ...(optional ? { optional } : {}) });
    }
  }
  return out;
}

/** Inverse of {@link parseRequirementLines} — render requirements as editable text. */
export function formatRequirementLines(requires: readonly CapabilityRequirement[] = []): string {
  return requires
    .map((r) => {
      const selector = r.name ?? (r.tag ? `#${r.tag}` : '');
      return `${r.kind} ${selector}${r.optional ? ' optional' : ''}`.trim();
    })
    .join('\n');
}
