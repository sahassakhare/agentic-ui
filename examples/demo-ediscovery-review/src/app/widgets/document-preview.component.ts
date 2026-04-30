import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * Generative-UI widget rendered when a review tool returns a document.
 * Two-column "split-pane" feel — left column shows metadata + tags,
 * right column shows a content snippet preview. Production-grade
 * eDiscovery would render the full native and image renditions side
 * by side; this is the demo-equivalent surface area.
 */
@Component({
  selector: 'app-document-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article class="card" [class.privileged]="isPrivileged()">
      <header>
        <span class="badge type">{{ extension() }}</span>
        <strong>{{ fileName() }}</strong>
        @if (isPrivileged()) {
          <span class="badge privilege">{{ privilegeReason() }}</span>
        }
      </header>
      <div class="grid">
        <dl class="meta">
          <dt>ID</dt><dd><code>{{ documentId() }}</code></dd>
          <dt>Custodian</dt><dd><code>{{ custodianId() }}</code></dd>
          <dt>Authored by</dt><dd>{{ authoredBy() }}</dd>
          <dt>Authored at</dt><dd>{{ authoredAt() }}</dd>
        </dl>
        <div class="snippet">
          <p class="caption">Content snippet</p>
          <pre>{{ contentSnippet() }}</pre>
        </div>
      </div>
      <footer>
        @if (tags().length === 0) {
          <span class="muted">no tags</span>
        } @else {
          @for (t of tags(); track t) {
            <span class="tag" [class.tag-priv]="t === 'privileged'" [class.tag-hot]="t === 'hot'" [class.tag-resp]="t === 'responsive'">{{ t }}</span>
          }
        }
      </footer>
    </article>
  `,
  styles: `
    .card { padding: 0.7rem 0.9rem; border: 1px solid #d1d5db; border-radius: 0.5rem; background: #fff; margin-top: 0.5rem; font: 0.86rem system-ui; border-left: 4px solid #6366f1; }
    .card.privileged { border-left-color: #b91c1c; }
    header { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin-bottom: 0.5rem; }
    .grid { display: grid; grid-template-columns: minmax(140px, 0.7fr) 1.3fr; gap: 0.7rem; }
    .meta { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 0.15rem 0.6rem; font-size: 0.8em; color: #475569; align-content: start; }
    .meta dt { font-weight: 500; color: #64748b; }
    .meta dd { margin: 0; color: #0f172a; word-break: break-all; }
    .snippet { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 0.5rem; }
    .snippet .caption { margin: 0 0 0.3rem; font-size: 0.7em; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
    .snippet pre { margin: 0; font: inherit; white-space: pre-wrap; word-break: break-word; max-height: 6rem; overflow: hidden; color: #1e293b; line-height: 1.45; }
    footer { display: flex; gap: 0.3rem; flex-wrap: wrap; margin-top: 0.55rem; padding-top: 0.45rem; border-top: 1px dashed #e2e8f0; }
    .muted { color: #94a3b8; font-size: 0.8em; }
    .badge { font-size: 0.65em; padding: 2px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
    .badge.type { background: #e0e7ff; color: #3730a3; }
    .badge.privilege { background: #fee2e2; color: #991b1b; margin-left: auto; }
    .tag { font-size: 0.7em; padding: 1px 7px; border-radius: 999px; background: #f1f5f9; color: #475569; }
    .tag-priv { background: #fee2e2; color: #991b1b; }
    .tag-hot { background: #fef3c7; color: #92400e; }
    .tag-resp { background: #d1fae5; color: #065f46; }
    code { font-size: 0.92em; background: rgba(15,23,42,0.04); padding: 1px 4px; border-radius: 3px; }
  `,
})
export class DocumentPreviewComponent {
  readonly documentId = input.required<string>();
  readonly fileName = input.required<string>();
  readonly custodianId = input.required<string>();
  readonly authoredBy = input.required<string>();
  readonly authoredAt = input.required<string>();
  readonly contentSnippet = input.required<string>();
  readonly tags = input.required<readonly string[]>();
  readonly privilegeReason = input.required<string | null>();

  protected readonly isPrivileged = computed(() => Boolean(this.privilegeReason()));
  protected readonly extension = computed(() => {
    const f = this.fileName();
    const dot = f.lastIndexOf('.');
    return dot === -1 ? 'file' : f.slice(dot + 1);
  });
}
