import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { APPROVAL_DIFF_INPUTS } from '@infra-tools/agentic-ui';

/**
 * Generic diff renderer for the F4 approval card.
 *
 * Reads `APPROVAL_DIFF_INPUTS` (provided per-card by the renderer) and
 * shows the literal arg payload as a structured `<dl>` table. Reviewer
 * signs off on what will execute on Approve — not an LLM-generated
 * summary, per AC-F4-3 "diff IS the arg payload" property.
 *
 * Tool-agnostic on purpose. Domain-specific diff widgets (e.g. a real
 * production-summary that joins against MatterStore) can be registered
 * under different names and referenced from `policy.diffRenderer`. This
 * one is the safe default for any approval policy.
 */
@Component({
  selector: 'app-approval-summary-diff',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dl class="diff" aria-label="Tool arguments for approval">
      @for (row of rows(); track row.key) {
        <dt>{{ row.label }}</dt>
        <dd>{{ row.value }}</dd>
      }
      @if (rows().length === 0) {
        <dt>(no arguments)</dt>
        <dd></dd>
      }
    </dl>
  `,
  styles: `
    :host { display: block; font: 0.85rem system-ui; }
    .diff { display: grid; grid-template-columns: max-content 1fr; gap: 0.3rem 0.7rem; margin: 0; }
    dt { font-size: 0.8rem; font-weight: 500; color: #6b7280; padding-top: 0.1rem; text-transform: capitalize; }
    dd { margin: 0; color: #111827; word-break: break-word; }
  `,
})
export class ApprovalSummaryDiffComponent {
  private readonly inputs = inject(APPROVAL_DIFF_INPUTS, { optional: true });

  protected readonly rows = computed<readonly { key: string; label: string; value: string }[]>(() => {
    const args = this.inputs?.args;
    if (!args || typeof args !== 'object') return [];
    return Object.entries(args as Record<string, unknown>).map(([key, value]) => ({
      key,
      label: prettyLabel(key),
      value: stringifyValue(value),
    }));
  });
}

function prettyLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
