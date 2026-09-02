/**
 * The in-Studio authoring copilot — a side rail wrapping the platform's own
 * `<mvk-chat-shell>`. It is shown only when the `aiAssistedAuthoring` flag
 * resolves true (platform default AND tenant policy AND not author-opted-out),
 * so the top-bar toggle live-hides it. On construct it wires `authoringBridge`
 * to the catalog service so the authoring tools (which run outside DI) can draft
 * governed capabilities as `ai-assisted` drafts the author refines in the designers.
 */
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ChatShellComponent } from '@infra-tools/agentic-ui';
import { FeatureFlagsService } from '../services/feature-flags.service';
import { CapabilityCatalogService, type Capability } from '../services/capability-catalog.service';
import { authoringBridge, recentDrafts, designerPathFor, type AuthoringDraft } from './authoring-bridge';

const ALL_KINDS = ['form', 'page', 'workflow', 'decision', 'application', 'theme', 'experience', 'tool', 'datasource', 'prompt', 'skill', 'navigation', 'validation'];

@Component({
  selector: 'aes-copilot-rail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChatShellComponent],
  template: `
    @if (flags.aiAssistedAuthoring()) {
      <aside class="copilot" aria-label="AI authoring assistant">
        <header class="chd"><span class="dot"></span> AI Authoring <span class="sub">drafts capabilities</span></header>
        @if (recent().length) {
          <div class="drafts" aria-label="Recently drafted capabilities">
            @for (d of recent(); track d.id) {
              <button class="open" (click)="open(d)" [title]="openLabel(d)">
                <span class="cat" [attr.data-kind]="d.kind">{{ kindLabel(d.kind) }}</span>
                <span class="dn">{{ d.name }}</span>
                <span class="go">{{ openLabel(d) }} →</span>
              </button>
            }
          </div>
        }
        <mvk-chat-shell mode="rail" showToolCalls="compact" placeholder="Describe a capability to draft…" />
      </aside>
    }
  `,
  styles: [`
    .copilot { display:flex; flex-direction:column; min-height:0; width:360px; height:calc(100dvh - 112px); border-left:1px solid rgba(120,120,140,.16); padding:0 12px; }
    @media (max-width: 1100px) { .copilot { display:none; } }
    .chd { display:flex; align-items:center; gap:8px; padding:12px 4px; font-size:13px; font-weight:600; border-bottom:1px solid rgba(120,120,140,.14); }
    .chd .dot { width:8px; height:8px; border-radius:50%; background:#0a7d32; } .chd .sub { margin-left:auto; font-size:11px; font-weight:400; opacity:.5; }
    .drafts { display:flex; flex-direction:column; gap:6px; margin:10px 0; max-height:38%; overflow:auto; }
    .open { display:grid; grid-template-columns:auto 1fr; grid-template-areas:"cat name" "cat go"; column-gap:8px; align-items:center;
      padding:7px 10px; border:1px solid rgba(103,80,164,.35); border-radius:9px; background:rgba(103,80,164,.08); color:inherit; font:inherit; text-align:left; cursor:pointer; }
    .open:hover { background:rgba(103,80,164,.16); }
    .cat { grid-area:cat; align-self:center; font-size:10px; font-weight:700; letter-spacing:.02em; text-transform:uppercase;
      padding:3px 7px; border-radius:999px; background:rgba(103,80,164,.16); color:#6750a4; white-space:nowrap; }
    @media (prefers-color-scheme: dark) { .cat { color:#d0bcff; background:rgba(208,188,255,.16); } }
    .dn { grid-area:name; font-size:12.5px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .go { grid-area:go; font-size:11px; opacity:.6; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    mvk-chat-shell { flex:1; min-height:0; display:block; }
  `],
})
export class CopilotRailComponent {
  protected readonly flags = inject(FeatureFlagsService);
  private readonly caps = inject(CapabilityCatalogService);
  private readonly router = inject(Router);
  protected readonly recent = recentDrafts;

  /** Capitalized singular kind, e.g. "form" → "Form". */
  protected kindLabel(kind: string): string { return kind.charAt(0).toUpperCase() + kind.slice(1); }
  /** True when the kind opens a rich designer (path ends /design) vs. its category list. */
  protected isDesigner(d: AuthoringDraft): boolean { return d.designerPath.endsWith('/design'); }
  /** Honest action label: the designer for designer-kinds, otherwise the category list. */
  protected openLabel(d: AuthoringDraft): string {
    return this.isDesigner(d) ? `Open in the ${d.kind} designer` : `Go to ${this.kindLabel(d.kind)}`;
  }

  constructor() {
    authoringBridge.createDraft = async (kind, name, body): Promise<AuthoringDraft> => {
      const c = await firstValueFrom(this.caps.create({ kind, name, body, authoredBy: 'ai-assisted' }));
      const draft = { id: c.id, name: c.name, kind: c.kind, designerPath: designerPathFor(c.kind, c.id) };
      // Take the author straight into the designer (the draft→refine flow). The
      // rail lives in the app shell, so it persists across this navigation; the
      // "Open in designer" button remains as a way back to the last draft.
      void this.router.navigateByUrl(draft.designerPath);
      return draft;
    };
    authoringBridge.list = async (kind) => {
      const kinds = kind ? [kind] : ALL_KINDS;
      const results = await Promise.all(
        kinds.map((k) => firstValueFrom(this.caps.listByKind(k)).catch(() => ({ items: [] }))),
      );
      return results.flatMap((r) => (r.items ?? []).map((c) => ({
        id: c.id, name: c.name, kind: c.kind, lifecycle: (c as { lifecycle?: string }).lifecycle,
      })));
    };
    authoringBridge.get = async (idOrName, kind) => (await this.resolveCap(idOrName, kind))?.body ?? null;
    authoringBridge.updateDraft = async (idOrName, kind, bodyPatch): Promise<AuthoringDraft> => {
      const cap = await this.resolveCap(idOrName, kind);
      if (!cap) throw new Error(`Couldn't find "${idOrName}" to update.`);
      const merged = { ...cap.body, ...bodyPatch };
      const c = await firstValueFrom(this.caps.update(cap.id, { body: merged }, (cap as { version?: number }).version));
      const draft = { id: c.id, name: c.name, kind: c.kind, designerPath: designerPathFor(c.kind, c.id) };
      void this.router.navigateByUrl(draft.designerPath);
      return draft;
    };
    authoringBridge.openDesigner = (path) => { void this.router.navigateByUrl(path); };
    // Resolve the capability currently open in a designer from the URL, so the
    // copilot can act on "this"/"the open form" without the author naming it.
    authoringBridge.getActive = () => {
      const url = this.router.url.split('?')[0].replace(/^\/+/, '');
      // e.g. forms/<id>/design, workflows/<id>/design, decisions/<id>/design,
      // pages/<id>/design, applications/<id>/design, themes/<id>/design, experiences/<id>
      const m = url.match(/^([a-z]+)s\/([^/]+)(?:\/design)?$/);
      if (!m) return null;
      const [, kind, id] = m;
      return { id, kind };
    };
  }

  /** Resolve a capability by id, or by name within a kind (full record incl. version). */
  private async resolveCap(idOrName: string, kind?: string): Promise<Capability | null> {
    try { const c = await firstValueFrom(this.caps.get(idOrName)); if (c) return c; } catch { /* not an id */ }
    if (kind) {
      const r = await firstValueFrom(this.caps.listByKind(kind)).catch(() => ({ items: [] as readonly Capability[] }));
      return (r.items ?? []).find((x) => x.name === idOrName) ?? null;
    }
    return null;
  }

  protected open(d: AuthoringDraft): void {
    void this.router.navigateByUrl(d.designerPath);
  }
}
