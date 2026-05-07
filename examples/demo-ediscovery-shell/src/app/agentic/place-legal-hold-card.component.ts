import { ChangeDetectionStrategy, Component } from '@angular/core';
import { WorkflowRendererComponent } from '@maverick/agentic-ui';

/**
 * Generative-UI wrapper for the F3 `placeLegalHold` workflow.
 *
 * The agent emits this widget by name, the chat shell mounts it, and
 * `<mvk-workflow-renderer formName="placeLegalHold">` renders the
 * registered four-step wizard. The renderer holds its own
 * `CompositionStore`; values aggregate per step id and survive Back
 * navigation. On terminal Submit the workflow's `onComplete` runs
 * the same `MatterStore.addLegalHold` path the existing
 * `placeLegalHoldTool` uses — single domain handler, multiple surfaces.
 */
@Component({
  selector: 'app-place-legal-hold-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WorkflowRendererComponent],
  template: `
    <article class="card">
      <header>
        <span class="badge">workflow</span>
        <strong>Place legal hold</strong>
      </header>
      <mvk-workflow-renderer formName="placeLegalHold" />
    </article>
  `,
  styles: `
    .card {
      padding: 0.7rem 0.9rem; border: 1px solid #d1d5db;
      border-radius: 0.5rem; background: #fff; margin-top: 0.5rem;
      font: 0.88rem system-ui; border-left: 4px solid #4f46e5;
    }
    header { display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.4rem; }
    .badge { font-size: 0.7em; padding: 2px 6px; border-radius: 4px; background: #e0e7ff; color: #3730a3; text-transform: uppercase; letter-spacing: 0.04em; }
  `,
})
export class PlaceLegalHoldCardComponent {}
