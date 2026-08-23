import { ChangeDetectionStrategy, Component, HostListener, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { A11yModule } from '@angular/cdk/a11y';
import { CapabilityCatalogService } from '../services/capability-catalog.service';

interface Cmd {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly glyph: string;
  readonly keywords: string;
  readonly run: () => void;
}

/** Primary sections — mirrors the top-nav; each becomes a "Go to …" command. */
const SECTIONS: ReadonlyArray<{ path: string; label: string }> = [
  { path: '/experiences', label: 'Experiences' }, { path: '/templates', label: 'Templates' },
  { path: '/applications', label: 'Applications' },
  { path: '/pages', label: 'Pages' }, { path: '/components', label: 'Components' },
  { path: '/mfes', label: 'MFEs' }, { path: '/forms', label: 'Forms' },
  { path: '/workflows', label: 'Workflows' }, { path: '/decisions', label: 'Decisions' },
  { path: '/themes', label: 'Themes' }, { path: '/prompts', label: 'Prompts' },
  { path: '/skills', label: 'Skills' }, { path: '/knowledge', label: 'Knowledge' },
  { path: '/memory', label: 'Memory' }, { path: '/navigation', label: 'Navigation' },
  { path: '/tools', label: 'Tools' }, { path: '/datasources', label: 'Data Sources' },
  { path: '/validations', label: 'Validation' }, { path: '/policy', label: 'Policy' },
];

/** Kinds that have a dedicated designer, and the list route that owns them. */
const DESIGNER_ROUTE: Readonly<Record<string, string>> = {
  application: 'applications', page: 'pages', form: 'forms',
  workflow: 'workflows', decision: 'decisions', theme: 'themes',
};
const KIND_GLYPH: Readonly<Record<string, string>> = {
  application: '▤', page: '▦', form: '▤', workflow: '⇉', decision: '◇', theme: '◑',
};

/**
 * Global command palette (⌘K / Ctrl-K). Jump to any section, or straight to a
 * capability's designer. Keyboard-first (↑/↓/↵/esc), focus-trapped, themed by
 * the Studio design tokens. Mounted once in the shell.
 */
@Component({
  selector: 'aes-command-palette',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, A11yModule],
  template: `
    @if (open()) {
      <div class="cmdk-backdrop" (click)="close()"></div>
      <div class="cmdk" role="dialog" aria-modal="true" aria-label="Command palette" cdkTrapFocus cdkTrapFocusAutoCapture>
        <input class="cmdk-input" [ngModel]="query()" (ngModelChange)="setQuery($event)" (keydown)="onKey($event)"
               placeholder="Jump to a section or capability…" aria-label="Search commands" autocomplete="off" />
        <ul class="cmdk-list" role="listbox">
          @for (r of results(); track r.id; let i = $index) {
            <li role="option" [id]="'cmdk-' + i" [class.sel]="i === active()" [attr.aria-selected]="i === active()"
                (click)="run(r)" (mouseenter)="active.set(i)">
              <span class="glyph" aria-hidden="true">{{ r.glyph }}</span>
              <span class="lbl">{{ r.label }}</span>
              <span class="hint">{{ r.hint }}</span>
            </li>
          } @empty { <li class="empty">No matches</li> }
        </ul>
        <div class="cmdk-foot"><kbd>↑↓</kbd> navigate &nbsp; <kbd>↵</kbd> open &nbsp; <kbd>esc</kbd> close</div>
      </div>
    }
  `,
  styles: [`
    .cmdk-backdrop { position:fixed; inset:0; background:rgba(0,0,0,.38); z-index:200; }
    .cmdk { position:fixed; z-index:201; top:14vh; left:50%; transform:translateX(-50%); width:min(560px,92vw);
      background:var(--surface); color:var(--text); border:1px solid var(--border-strong); border-radius:var(--r-lg);
      box-shadow:0 24px 64px -16px rgba(0,0,0,.5); overflow:hidden; display:flex; flex-direction:column; }
    .cmdk-input { border:0; border-bottom:1px solid var(--border); background:transparent; color:var(--text);
      font:inherit; font-size:var(--fs-lg); padding:16px 18px; outline:none; }
    .cmdk-input::placeholder { color:var(--text-faint); }
    .cmdk-list { list-style:none; margin:0; padding:6px; max-height:52vh; overflow-y:auto; display:flex; flex-direction:column; gap:2px; }
    .cmdk-list li { display:flex; align-items:center; gap:12px; padding:10px 12px; border-radius:var(--r-sm); cursor:pointer; }
    .cmdk-list li.sel { background:var(--brand-soft); }
    .cmdk-list li.sel .lbl { color:var(--brand); }
    .cmdk-list .glyph { width:22px; text-align:center; color:var(--text-muted); }
    .cmdk-list .lbl { flex:1; font-size:var(--fs-sm); font-weight:500; }
    .cmdk-list .hint { font-family:var(--font-mono); font-size:var(--fs-xs); color:var(--text-faint); }
    .cmdk-list .empty { color:var(--text-faint); padding:18px 12px; justify-content:center; }
    .cmdk-foot { border-top:1px solid var(--border); padding:8px 14px; display:flex; gap:6px; align-items:center;
      font-size:var(--fs-xs); color:var(--text-faint); }
    .cmdk-foot kbd { font-family:var(--font-mono); background:var(--surface-2); border:1px solid var(--border);
      border-radius:4px; padding:1px 5px; font-size:10px; color:var(--text-muted); }
  `],
})
export class CommandPaletteComponent {
  private readonly router = inject(Router);
  private readonly caps = inject(CapabilityCatalogService);

  protected readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly active = signal(0);
  private readonly capCommands = signal<readonly Cmd[]>([]);
  private capsLoaded = false;

  private readonly sectionCommands: readonly Cmd[] = SECTIONS.map((s) => ({
    id: 'nav:' + s.path,
    label: 'Go to ' + s.label,
    hint: s.path,
    glyph: '→',
    keywords: (s.label + ' ' + s.path).toLowerCase(),
    run: () => void this.router.navigateByUrl(s.path),
  }));

  protected readonly results = computed<readonly Cmd[]>(() => {
    const q = this.query().trim().toLowerCase();
    const all = [...this.sectionCommands, ...this.capCommands()];
    const matched = q ? all.filter((c) => c.keywords.includes(q)) : this.sectionCommands;
    return matched.slice(0, 40);
  });

  @HostListener('document:keydown', ['$event'])
  protected onGlobalKey(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.toggle(); }
    else if (e.key === 'Escape' && this.open()) { e.preventDefault(); this.close(); }
  }

  protected toggle(): void { this.open() ? this.close() : this.openPalette(); }

  private openPalette(): void {
    this.query.set('');
    this.active.set(0);
    this.open.set(true);
    if (!this.capsLoaded) { this.capsLoaded = true; this.loadCapabilities(); }
  }

  protected close(): void { this.open.set(false); }

  protected setQuery(v: string): void { this.query.set(v); this.active.set(0); }

  protected onKey(e: KeyboardEvent): void {
    const n = this.results().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); this.active.set(n ? (this.active() + 1) % n : 0); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.active.set(n ? (this.active() - 1 + n) % n : 0); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = this.results()[this.active()]; if (r) this.run(r); }
  }

  protected run(cmd: Cmd): void { this.close(); cmd.run(); }

  /** Load designer-backed capabilities once, so the palette can jump straight to them. */
  private loadCapabilities(): void {
    for (const kind of Object.keys(DESIGNER_ROUTE)) {
      this.caps.listByKind(kind).subscribe({
        next: (res) => {
          const route = DESIGNER_ROUTE[kind];
          const cmds: Cmd[] = res.items.map((c) => ({
            id: 'cap:' + c.id,
            label: 'Design ' + c.name,
            hint: kind,
            glyph: KIND_GLYPH[kind] ?? '›',
            keywords: (c.name + ' ' + kind + ' design').toLowerCase(),
            run: () => void this.router.navigate(['/', route, c.id, 'design']),
          }));
          this.capCommands.update((cur) => [...cur, ...cmds]);
        },
        error: () => { /* a missing kind list shouldn't break the palette */ },
      });
    }
  }
}
