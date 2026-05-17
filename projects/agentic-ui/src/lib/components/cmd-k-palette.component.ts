import { NgClass } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IntentRegistry } from '../registries/intent-registry';
import { ToolRegistry } from '../registries/tool-registry';
import type { IntentDef, IntentTarget, ToolDef } from '../types/registry-defs';

/**
 * One row in the palette result list — either an intent (with a typed
 * `mapsTo` target) or a tool (the fallback when no intent matches).
 *
 * Intent rows carry a `target` so the host knows where to dispatch
 * (tool / action / route). Tool rows always dispatch to the tool with
 * the user's query as a free-form `chat` payload — the palette doesn't
 * try to fill out tool arguments from a single text input; that's the
 * agent's job.
 */
export type CmdKResult =
  | (IntentTarget & { readonly kind: 'tool' | 'action' | 'route'; readonly target: string; readonly source: 'intent'; readonly label: string; readonly description?: string })
  | { readonly kind: 'chat'; readonly source: 'tool' | 'free-text'; readonly target: string; readonly label: string; readonly description?: string };

/**
 * Cross-cutting agent-summon palette (`⌘K` / `Ctrl+K`) — Pillar 1
 * pattern 9 of [post-chat-surfaces-plan.md](../../../../docs/plans/post-chat-surfaces-plan.md)
 * + cookbook §11.
 *
 * On `⌘K` / `Ctrl+K` opens a centred overlay with a search input. As the
 * user types:
 *
 * 1. **Intents first.** Matches against `IntentRegistry.list()` using
 *    the registry's default substring matcher. Each match carries its
 *    typed `mapsTo` target (`tool` / `action` / `route`).
 * 2. **Tools fallback.** When no intent matches, lists tools from
 *    `ToolRegistry.list()` whose `name` or `description` substring-
 *    matches the query. Tool rows dispatch as a chat-style free-text
 *    invocation — the palette doesn't try to fill arguments from one
 *    input; that's the LLM's job.
 * 3. **Free-text fallback.** Bottom of the list always offers
 *    *"Ask: <query>"* — dispatches the raw query as a chat message.
 *
 * The component is **dispatch-agnostic.** It emits a `(selected)` event
 * with the resolved `CmdKResult` and the host wires the actual dispatch
 * (chat shell `sendMessage`, `Router.navigate`, `ActionRegistry.dispatch`,
 * or direct `tool.handler(args, ctx)`). Keeps the palette decoupled
 * from chat / routing / action concerns and reusable inside any host.
 *
 * Keyboard:
 * - **⌘K / Ctrl+K** open (anywhere in the document)
 * - **Esc** close
 * - **↑ / ↓** navigate results
 * - **Enter** select the highlighted result
 *
 * Persona scope: tool + intent reads go through the live `setScopePolicy`
 * filter, so a junior reviewer's palette shows fewer rows than a
 * partner's — uniform with every other registry read in the lib.
 *
 * @example
 * ```html
 * <mvk-cmd-k-palette (selected)="onPaletteSelect($event)" />
 * ```
 * ```ts
 * onPaletteSelect(r: CmdKResult): void {
 *   if (r.kind === 'route') this.router.navigateByUrl(r.target);
 *   else this.chat.sendMessage(r.target);   // chat / tool / free-text → agent
 * }
 * ```
 */
@Component({
  selector: 'mvk-cmd-k-palette',
  imports: [FormsModule, NgClass],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isOpen()) {
      <div class="backdrop" (click)="close()" role="presentation"></div>
      <div class="panel" role="dialog" aria-modal="true" aria-label="Command palette">
        <input #queryInput
               class="query"
               type="text"
               [ngModel]="query()"
               (ngModelChange)="query.set($event)"
               (keydown)="onKeydown($event)"
               placeholder="Search agent capabilities — try 'open custodian' or '/'..."
               aria-label="Command query"
               autocomplete="off" />
        <ul class="results" role="listbox">
          @for (row of results(); track row.label; let i = $index) {
            <li class="row"
                role="option"
                [attr.aria-selected]="i === highlighted()"
                [ngClass]="{ active: i === highlighted() }"
                (mouseenter)="highlighted.set(i)"
                (click)="select(row)">
              <span class="kind" [attr.data-kind]="row.kind">{{ kindLabel(row.kind) }}</span>
              <span class="label">{{ row.label }}</span>
              @if (row.description) {
                <span class="desc">{{ row.description }}</span>
              }
            </li>
          } @empty {
            <li class="row empty" role="option">No matching intents or tools.</li>
          }
        </ul>
      </div>
    }
  `,
  styles: `
    :host { display: contents; font-family: system-ui, sans-serif; }
    .backdrop {
      position: fixed; inset: 0; background: rgba(15, 23, 42, 0.45);
      z-index: 1000; backdrop-filter: blur(2px);
    }
    .panel {
      position: fixed; left: 50%; top: 18%; transform: translateX(-50%);
      z-index: 1001; width: min(640px, calc(100vw - 2rem));
      background: white; border-radius: 0.6rem;
      box-shadow: 0 12px 40px rgba(15, 23, 42, 0.25);
      display: flex; flex-direction: column; max-height: 60vh;
    }
    .query {
      border: 0; padding: 0.9rem 1rem; font-size: 1rem;
      border-bottom: 1px solid #e5e7eb; outline: 0;
      border-top-left-radius: 0.6rem; border-top-right-radius: 0.6rem;
    }
    .results { list-style: none; margin: 0; padding: 0.4rem 0; overflow-y: auto; }
    .row {
      display: flex; align-items: center; gap: 0.6rem;
      padding: 0.6rem 1rem; cursor: pointer; font-size: 0.95em;
    }
    .row.active { background: #eef2ff; }
    .row.empty { color: #9ca3af; cursor: default; }
    .kind {
      padding: 0.1rem 0.45rem; border-radius: 999px;
      font-size: 0.7em; font-weight: 600; text-transform: uppercase;
      color: white; background: #6366f1;
      flex-shrink: 0;
    }
    .kind[data-kind="tool"] { background: #2563eb; }
    .kind[data-kind="action"] { background: #16a34a; }
    .kind[data-kind="route"] { background: #ea580c; }
    .kind[data-kind="chat"] { background: #6b7280; }
    .label { font-weight: 500; color: #111827; }
    .desc { color: #6b7280; font-size: 0.85em; flex: 1; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `,
})
export class CmdKPaletteComponent {
  /**
   * Fires when the user picks a result. The host wires actual dispatch
   * (chat / router / action) so the palette stays decoupled from those
   * concerns. The palette closes itself before emitting.
   */
  readonly selected = output<CmdKResult>();

  protected readonly isOpen = signal(false);
  protected readonly query = signal('');
  protected readonly highlighted = signal(0);

  private readonly intents = inject(IntentRegistry);
  private readonly tools = inject(ToolRegistry);

  @ViewChild('queryInput') private readonly queryInputRef?: ElementRef<HTMLInputElement>;

  /**
   * Open the palette from anywhere — `⌘K` on Mac, `Ctrl+K` elsewhere.
   * Also opens on `/` when no input is focused (Slack/GitHub-style).
   */
  @HostListener('document:keydown', ['$event'])
  protected onGlobalKeydown(ev: KeyboardEvent): void {
    const isSummon =
      (ev.key === 'k' || ev.key === 'K') && (ev.metaKey || ev.ctrlKey);
    const isSlash =
      ev.key === '/' &&
      !this.isInputElement(document.activeElement) &&
      !this.isOpen();
    if (isSummon || isSlash) {
      ev.preventDefault();
      this.open();
      return;
    }
    if (ev.key === 'Escape' && this.isOpen()) {
      ev.preventDefault();
      this.close();
    }
  }

  protected readonly results = computed<readonly CmdKResult[]>(() => {
    const q = this.query().trim();
    const lower = q.toLowerCase();
    const intentRows = this.matchIntents(lower);
    const toolRows = intentRows.length === 0 ? this.matchTools(lower) : [];
    const freeText: CmdKResult[] = q
      ? [{ kind: 'chat', source: 'free-text', target: q, label: `Ask: "${q}"`, description: 'Send as chat prompt' }]
      : [];
    return [...intentRows, ...toolRows, ...freeText];
  });

  protected open(): void {
    this.isOpen.set(true);
    this.query.set('');
    this.highlighted.set(0);
    // Focus the input on the next tick — the @if has to flip on first.
    queueMicrotask(() => this.queryInputRef?.nativeElement.focus());
  }

  protected close(): void {
    this.isOpen.set(false);
  }

  protected onKeydown(ev: KeyboardEvent): void {
    const rows = this.results();
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      this.highlighted.update((i) => Math.min(rows.length - 1, i + 1));
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      this.highlighted.update((i) => Math.max(0, i - 1));
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const row = rows[this.highlighted()];
      if (row) this.select(row);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      this.close();
    }
  }

  protected select(row: CmdKResult): void {
    if (row.label.startsWith('No matching')) return;
    this.close();
    this.selected.emit(row);
  }

  protected kindLabel(kind: CmdKResult['kind']): string {
    switch (kind) {
      case 'tool': return 'tool';
      case 'action': return 'action';
      case 'route': return 'route';
      case 'chat': return 'chat';
    }
  }

  // ── matchers ─────────────────────────────────────────────────────

  private matchIntents(query: string): CmdKResult[] {
    if (!query) return [];
    const out: CmdKResult[] = [];
    for (const intent of this.intents.list() as readonly IntentDef[]) {
      if (this.intentMatches(intent, query)) {
        out.push({
          ...intent.mapsTo,
          source: 'intent',
          label: intent.description || intent.name,
          description: intent.examples[0] ?? undefined,
        });
      }
    }
    return out;
  }

  private intentMatches(intent: IntentDef, lowerQuery: string): boolean {
    if (intent.examples.some((ex) => ex.toLowerCase().includes(lowerQuery))) return true;
    if (intent.description.toLowerCase().includes(lowerQuery)) return true;
    if (intent.name.toLowerCase().includes(lowerQuery)) return true;
    return false;
  }

  private matchTools(query: string): CmdKResult[] {
    if (!query) return [];
    const out: CmdKResult[] = [];
    for (const tool of this.tools.list() as readonly ToolDef[]) {
      if (
        tool.name.toLowerCase().includes(query) ||
        tool.description.toLowerCase().includes(query)
      ) {
        out.push({
          kind: 'chat',
          source: 'tool',
          target: `${tool.name}: ${query}`,
          label: tool.name,
          description: tool.description,
        });
      }
    }
    return out;
  }

  private isInputElement(el: Element | null): boolean {
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    return (el as HTMLElement).isContentEditable === true;
  }
}
