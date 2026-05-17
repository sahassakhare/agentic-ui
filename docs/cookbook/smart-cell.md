# Agent-computed table cells with `<mvk-smart-cell>`

> **Status:** ships in v1.2.x (P1.2 of [post-chat-surfaces plan](../plans/post-chat-surfaces-plan.md)) · **Pattern:** §3 Pillar 1 row 1

`<mvk-smart-cell>` turns one column of a table into an **agent-computed lens** — privilege confidence on `Documents`, hold-acknowledgment status on `Custodians`, redaction-density on a production manifest. The cell renders a tool-computed value through a registered widget, hides itself per persona scope, and surfaces an explainability popover on hover.

This cookbook walks the canonical eDiscovery scenario: **"Privilege Confidence" column on the Documents list.**

## 1. Drop it into a table

```ts
import { Component } from '@angular/core';
import { SmartCellComponent } from '@infra-tools/agentic-ui';

@Component({
  selector: 'app-documents-table',
  imports: [SmartCellComponent /* + your existing table primitives */],
  template: `
    <table>
      <tr *ngFor="let doc of docs()">
        <td>{{ doc.bates }}</td>
        <td>{{ doc.title }}</td>
        <td>
          <mvk-smart-cell
            [value]="doc.privilegeConfidence"
            [loading]="doc.classificationLoading"
            [error]="doc.classificationError"
            widget="privilegeConfidencePill"
            hoverWidget="privilegeConfidenceDetail"
            tool="runTARClassifier" />
        </td>
      </tr>
    </table>
  `,
})
class DocumentsTable {
  // doc is your row shape — privilegeConfidence is a number 0..100
  // or undefined (the cell hides loading/error/blocked states behind
  // the appropriate inputs).
}
```

That's it. The cell does:

- **persona scope** — when the active persona can't see `runTARClassifier` via `ToolRegistry.get()`, the cell renders an em-dash placeholder. No conditional wrapping in your template.
- **loading state** — `[loading]="true"` shows an unobtrusive `…` placeholder with `aria-busy="true"` so screen readers don't announce stale values.
- **error state** — `[error]="message"` renders an `✗` badge with the message in `title` (mouse hover, screen-reader announcement).
- **value render** — looks up `widget` in `ComponentRegistry`, Zod-validates `{ value }` against `ComponentDef.propsSchema`, mounts via `*ngComponentOutlet`.
- **hover detail** — looks up `hoverWidget` in `ComponentRegistry`, reveals it below the cell on hover / focus / tap. Touch surfaces get a tap-toggle.
- **plain-text fallback** — when `widget` is omitted (or the name isn't registered), the value is stringified directly. Objects go through `JSON.stringify` so a `{ score: 0.87 }` doesn't render as `[object Object]`.

## 2. Register the widgets

The pill and detail widgets are regular `ComponentRegistry` entries:

```ts
import { agenticWidget } from '@infra-tools/agentic-ui';
import { z } from 'zod';

provideAgenticUi({
  widgets: [
    agenticWidget({
      name: 'privilegeConfidencePill',
      component: PrivilegeConfidencePillComponent,
      propsSchema: z.object({ value: z.number() }),
    }),
    agenticWidget({
      name: 'privilegeConfidenceDetail',
      component: PrivilegeConfidenceDetailComponent,
      propsSchema: z.object({ value: z.number() }),
    }),
  ],
});
```

Both widgets receive the same `value` as a bound input — the pill renders the score, the detail renders the explanation. Use whatever component shape your design system wants; the cell doesn't care.

## 3. Wire the value flow (host-driven)

The cell is presentation-only — *how* `privilegeConfidence` lands on `doc` is host-driven. Three common patterns:

### Eager pre-compute (default for batch-classified data)

The classifier ran at ingest; the score is in your domain model. Just bind it:

```ts
docs = computed(() => this.matter.documents().map(d => ({
  ...d,
  privilegeConfidence: d.tarScore ?? null,
  classificationLoading: false,
})));
```

### Lazy on visibility (large tables)

Use an `IntersectionObserver` to trigger the classifier when the row scrolls into view:

```ts
@HostListener('inView')
async onRowVisible(doc: Document) {
  if (doc.privilegeConfidence != null) return;
  doc.classificationLoading = true;
  try {
    doc.privilegeConfidence = await this.classifier.score(doc.id);
  } catch (e) {
    doc.classificationError = e.message;
  } finally {
    doc.classificationLoading = false;
  }
}
```

### Live via `DataSourceRegistry`

For values that change (e.g. "redaction density updates as the reviewer works"), wire a `DataSource` and bind through it. The cell honours whatever signal/observable shape your host wires.

## 4. Persona scope in action

Junior reviewer: `runTARClassifier` is denied. Every `<mvk-smart-cell tool="runTARClassifier">` renders `—`. No conditional template, no `*ngIf`.

Partner: same template, full visibility, hover-for-detail works as expected.

GC: same template. They see the value but also a hover detail panel that links to the audit chain — *because they registered a different `privilegeConfidenceDetail` widget under the GC persona's `setProviderHook`*.

Same `<mvk-smart-cell>`, six different rendered cells.

## 5. The architectural property

Every visible cell is a tool call. Hover reveals the explanation = another tool call. The audit chain captures both. *"How did the agent decide D-117 was privileged?"* is a registry lookup, not a forensic investigation.

This is what the [post-chat-surfaces plan §3 Pillar 1 row 1](../plans/post-chat-surfaces-plan.md#pillar-1--web-surface-patterns-post-chat-affordances) means by "smart cells in tables": **the table isn't displaying data, it's displaying the agent's view of the data**.

## 6. Reference

- **Component:** `<mvk-smart-cell [value] [loading] [error] [widget] [hoverWidget] [tool] />`
- **Tests:** 17 specs covering loading/error/widget/text rendering, persona scope filtering, hover + focus + tap detail toggle, registry fallback on unknown widget name
- **Plan:** [post-chat-surfaces-plan §3 Pillar 1 pattern 1](../plans/post-chat-surfaces-plan.md#pillar-1--web-surface-patterns-post-chat-affordances)
- **Related:**
  - [⌘K / Ctrl+K palette](./cmd-k-palette.md) — the cell handles row-level agent computation; the palette handles app-wide agent summon
  - [Agent-directed workspace layouts (ADR-043)](./agent-directed-workspace-layouts.md) — slot-based composition for whole-route layouts
  - `ToolRegistry.setScopePolicy` — the persona seam this cell honours
