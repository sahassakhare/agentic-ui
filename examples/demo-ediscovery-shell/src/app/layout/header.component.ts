import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ToolRegistry } from '@maverick/agentic-ui';
import { listAuditEvents, listLegalHolds } from '@maverick/demo-ediscovery-shared';
import { environment } from '../../environments/environment';
import { IconComponent } from '../ui/icon.component';
import { PERSONAS, PersonaService, type Persona } from '../services/persona.service';

/**
 * Top header. Three regions:
 *  - Left: matter selector (one matter for now; the dropdown affords multi-matter Phase 4+).
 *  - Center: global search bar (placeholder — Phase 4 wires it to `semanticSearchTool`).
 *  - Right: notifications, persona menu, settings.
 *
 * The persona menu is functional today: switching role updates
 * `PersonaService.active` which Phase 7's tool-filter shim will read.
 */
@Component({
  selector: 'app-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <header class="bar">
      <div class="left">
        <button type="button" class="matter" (click)="toggleMatter()">
          <span class="matter-id">{{ matterId }}</span>
          <span class="matter-name">In re Acme Corp Securities Litigation</span>
          <svg-icon name="chevron-down" [size]="14" />
        </button>
      </div>

      <div class="center">
        <label class="search">
          <svg-icon name="search" [size]="15" />
          <input type="text" placeholder="Search documents, custodians, holds…" disabled
                 aria-label="Global search (Phase 4 — semanticSearch)" />
          <kbd>/</kbd>
        </label>
      </div>

      <div class="right">
        <button type="button" class="icon-btn" aria-label="Notifications" [class.has-pip]="pendingCount() > 0">
          <svg-icon name="bell" [size]="17" />
          @if (pendingCount() > 0) {
            <span class="pip">{{ pendingCount() }}</span>
          }
        </button>

        <div class="persona-wrap">
          <button type="button" class="persona-btn" (click)="togglePersona()">
            <span class="avatar">{{ activeProfile().initials }}</span>
            <span class="persona-meta">
              <span class="persona-label">{{ activeProfile().label }}</span>
              <span class="persona-desc">{{ activeProfile().description }}</span>
            </span>
            <svg-icon name="chevron-down" [size]="14" />
          </button>
          @if (personaOpen()) {
            <div class="persona-menu" role="menu">
              <p class="menu-title">Switch persona</p>
              @for (p of personas; track p.id) {
                <button type="button" role="menuitem" class="menu-item" (click)="select(p.id)" [class.selected]="active() === p.id">
                  <span class="avatar small">{{ p.initials }}</span>
                  <span class="meta">
                    <strong>{{ p.label }}</strong>
                    <span>{{ p.description }}</span>
                  </span>
                  <span class="tool-count">{{ allowedFor(p.id) }} / {{ totalTools() }}</span>
                  @if (active() === p.id) { <svg-icon name="check" [size]="14" /> }
                </button>
              }
              <p class="menu-foot">
                Persona-scoped <strong>tool filter</strong> active. The agent
                only sees the count above (further narrowed to the top 12 by
                keyword overlap) on each turn.
              </p>
            </div>
          }
        </div>

        <button type="button" class="icon-btn" aria-label="Settings"><svg-icon name="settings" [size]="17" /></button>
      </div>
    </header>
  `,
  styles: `
    .bar {
      height: var(--header-h); position: sticky; top: 0; z-index: 5;
      display: grid; grid-template-columns: minmax(280px, 0.7fr) minmax(280px, 1fr) auto;
      align-items: center; gap: var(--s-4);
      padding: 0 var(--s-5);
      background: var(--c-surface-0);
      border-bottom: 1px solid var(--c-border);
    }
    .left { display: flex; align-items: center; gap: var(--s-3); }
    .matter {
      display: inline-flex; align-items: center; gap: var(--s-2);
      padding: 0.35rem 0.7rem; background: var(--c-surface-2);
      border: 1px solid var(--c-border); border-radius: var(--r-md);
      cursor: pointer; transition: background var(--t-fast);
    }
    .matter:hover { background: var(--c-surface-3); }
    .matter-id { font-family: ui-monospace, monospace; font-size: var(--fs-xs); color: var(--c-text-mute); }
    .matter-name { font-size: var(--fs-sm); color: var(--c-text); font-weight: 500; }

    .center { display: flex; }
    .search {
      flex: 1; max-width: 560px;
      display: inline-flex; align-items: center; gap: var(--s-2);
      padding: 0.4rem 0.7rem;
      background: var(--c-surface-1); border: 1px solid var(--c-border); border-radius: var(--r-md);
      color: var(--c-text-mute);
    }
    .search:focus-within { border-color: var(--c-brand); background: var(--c-surface-0); }
    .search input { flex: 1; border: 0; background: transparent; outline: none; font: inherit; color: var(--c-text); }
    .search input::placeholder { color: var(--c-text-faint); }
    .search input:disabled { cursor: not-allowed; }
    kbd {
      padding: 0 6px; height: 18px; min-width: 18px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--c-surface-0); border: 1px solid var(--c-border-strong);
      border-radius: var(--r-sm); font-size: 0.65rem; color: var(--c-text-mute);
    }

    .right { display: flex; align-items: center; gap: var(--s-2); }
    .icon-btn {
      width: 34px; height: 34px;
      display: inline-flex; align-items: center; justify-content: center;
      background: transparent; border: 1px solid transparent; border-radius: var(--r-md);
      color: var(--c-text-2); cursor: pointer; position: relative;
      transition: background var(--t-fast), color var(--t-fast);
    }
    .icon-btn:hover { background: var(--c-surface-2); color: var(--c-text); }
    .pip {
      position: absolute; top: 4px; right: 4px;
      min-width: 16px; height: 16px; padding: 0 4px;
      background: var(--c-bad); color: white;
      border-radius: var(--r-pill); font-size: 0.6rem; font-weight: 600;
      display: inline-flex; align-items: center; justify-content: center;
      border: 2px solid var(--c-surface-0);
    }

    .persona-wrap { position: relative; }
    .persona-btn {
      display: inline-flex; align-items: center; gap: var(--s-2);
      padding: 0.25rem 0.5rem 0.25rem 0.25rem;
      background: transparent; border: 1px solid transparent; border-radius: var(--r-md);
      cursor: pointer; transition: background var(--t-fast);
    }
    .persona-btn:hover { background: var(--c-surface-2); }
    .avatar {
      width: 30px; height: 30px;
      display: inline-flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, #818cf8, var(--c-brand-strong));
      color: white; border-radius: var(--r-pill);
      font-size: 0.72rem; font-weight: 600; letter-spacing: 0.02em;
    }
    .avatar.small { width: 26px; height: 26px; font-size: 0.66rem; }
    .persona-meta {
      display: flex; flex-direction: column; align-items: flex-start;
      line-height: 1.15; text-align: left;
    }
    .persona-label { font-size: var(--fs-sm); color: var(--c-text); font-weight: 500; }
    .persona-desc { font-size: 0.65rem; color: var(--c-text-mute); max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .persona-menu {
      position: absolute; right: 0; top: 100%; margin-top: 6px;
      width: 320px; background: var(--c-surface-0);
      border: 1px solid var(--c-border); border-radius: var(--r-lg);
      box-shadow: var(--sh-pop);
      padding: var(--s-2); z-index: 10;
    }
    .menu-title {
      margin: 0; padding: 0.3rem 0.6rem 0.4rem;
      font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--c-text-faint); font-weight: 600;
    }
    .menu-item {
      width: 100%; display: flex; align-items: center; gap: var(--s-3);
      padding: var(--s-2) var(--s-3); background: transparent;
      border: 0; border-radius: var(--r-md); cursor: pointer;
      text-align: left;
      transition: background var(--t-fast);
    }
    .menu-item:hover { background: var(--c-surface-2); }
    .menu-item.selected { background: var(--c-brand-tint); }
    .menu-item .meta { display: flex; flex-direction: column; line-height: 1.2; flex: 1; }
    .menu-item .meta strong { font-size: var(--fs-sm); color: var(--c-text); font-weight: 600; }
    .menu-item .meta span { font-size: 0.7rem; color: var(--c-text-mute); }
    .menu-item svg-icon { color: var(--c-brand); }
    .tool-count {
      padding: 1px 8px; border-radius: var(--r-pill);
      background: var(--c-surface-2); color: var(--c-text-2);
      font-size: 0.65rem; font-weight: 600;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .menu-item.selected .tool-count { background: var(--c-brand-soft); color: var(--c-brand-strong); }
    .menu-foot {
      margin: var(--s-2) 0 0; padding: var(--s-2) var(--s-3);
      font-size: 0.7rem; color: var(--c-text-faint); line-height: 1.4;
      border-top: 1px solid var(--c-divider);
    }
    .menu-foot strong { color: var(--c-text-2); }
  `,
})
export class HeaderComponent {
  protected readonly matterId = environment.matterId;
  protected readonly personaService = inject(PersonaService);
  private readonly toolRegistry = inject(ToolRegistry);

  protected readonly active = this.personaService.active;
  protected readonly activeProfile = computed(() => this.personaService.profile(this.active()));
  protected readonly personas = PERSONAS;
  protected readonly personaOpen = signal(false);

  /** Live total — recomputes when remotes load capabilities. */
  protected readonly totalTools = computed(() => this.toolRegistry.signal().length);

  /** How many of the registered tools the given persona may invoke. */
  protected allowedFor(p: Persona): number {
    const tools = this.toolRegistry.signal();
    return tools.filter((t) => this.personaService.canInvoke(p, t.name)).length;
  }

  /** Notification pip — drives off pending hold acknowledgements + recent audit events. */
  protected readonly pendingCount = computed(() => {
    const pendingHolds = listLegalHolds(environment.matterId).filter((h) => !h.acknowledgedAt && !h.releasedAt).length;
    return pendingHolds;
  });

  togglePersona(): void { this.personaOpen.update((v) => !v); }
  toggleMatter(): void { /* placeholder — multi-matter Phase 4 */ }

  select(p: Persona): void {
    this.personaService.setActive(p);
    this.personaOpen.set(false);
  }
}
