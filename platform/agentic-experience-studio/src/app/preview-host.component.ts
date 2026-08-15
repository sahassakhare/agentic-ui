import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, input, viewChild } from '@angular/core';

/**
 * Generic, component-AGNOSTIC preview host. The catalog stores metadata only, so
 * a registry entry declares HOW to preview itself in `body.preview` and this host
 * renders that — it knows nothing about Angular Material or any specific widget.
 *
 *   body.preview = {
 *     type: 'html' | 'image' | 'mfe',
 *     html?: string,   // self-contained markup (may include <style>) → sandboxed iframe
 *     src?: string,    // image/thumbnail URL or data URI
 *     height?: number, // preview box height (px)
 *   }
 *
 * `html` is rendered inside a **sandboxed** iframe (no scripts, no same-origin),
 * so arbitrary author-supplied markup + CSS renders with full fidelity yet is
 * isolated and cannot touch the Studio — safe even for tenant-authored content.
 * `mfe` is reserved for loading a federated remote's live component (the same
 * federation path the runtime uses); it shows a hint until wired.
 */
export interface PreviewDescriptor {
  readonly type: 'html' | 'image' | 'mfe';
  readonly html?: string;
  readonly src?: string;
  readonly height?: number;
  readonly manifestUrl?: string;
  readonly exposedModule?: string;
}

@Component({
  selector: 'aes-preview-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let p = preview();
    @if (p?.type === 'html') {
      <iframe #frame class="pv-frame" sandbox="" [style.height.px]="p!.height ?? 200" title="Component preview" loading="lazy"></iframe>
    } @else if (p?.type === 'image' && p!.src) {
      <img class="pv-img" [src]="p!.src" alt="Component preview" [style.max-height.px]="p!.height ?? 220" />
    } @else if (p?.type === 'mfe') {
      <div class="pv-none">Live MFE preview — loads the federated remote at render time
        (<code>{{ p!.manifestUrl ?? 'manifest' }}</code>).</div>
    } @else {
      <div class="pv-none">No preview declared. Add a <code>preview</code> block to this entry's
        body (<code>type: 'html' | 'image' | 'mfe'</code>) to show one.</div>
    }
  `,
  styles: [`
    :host { display: block; }
    .pv-frame { width: 100%; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface); }
    .pv-img { max-width: 100%; border: 1px solid var(--border); border-radius: var(--r-md); display: block; margin: 0 auto; }
    .pv-none { font-size: var(--fs-sm); color: var(--text-muted); border: 1px dashed var(--border); border-radius: var(--r-md);
      padding: var(--s5); text-align: center; }
    .pv-none code { font-family: var(--font-mono); font-size: .9em; }
  `],
})
export class PreviewHostComponent {
  /** Any object carrying a `body.preview` (a catalog capability). */
  readonly capability = input.required<{ body: Record<string, unknown> }>();
  readonly preview = computed<PreviewDescriptor | null>(() => {
    const pv = this.capability().body?.['preview'];
    return pv && typeof pv === 'object' ? (pv as PreviewDescriptor) : null;
  });

  private readonly frame = viewChild<ElementRef<HTMLIFrameElement>>('frame');

  constructor() {
    // Set srcdoc imperatively (direct DOM) so the self-contained markup — <style>
    // included — renders verbatim inside the sandbox, bypassing template
    // sanitization. Safe because the iframe sandbox blocks scripts + same-origin.
    effect(() => {
      const p = this.preview();
      const el = this.frame()?.nativeElement;
      if (el && p?.type === 'html' && typeof p.html === 'string') el.srcdoc = p.html;
    });
  }
}
