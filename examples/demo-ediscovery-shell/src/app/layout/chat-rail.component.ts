import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ChatShellComponent, ToolRegistry, CapabilityRegistry } from '@maverick/agentic-ui';
import { IconComponent } from '../ui/icon.component';
import { PersonaService } from '../services/persona.service';

/**
 * Right-rail wrapper for `<mvk-chat-shell>`. Adds an enterprise-grade
 * chrome — agent identity badge, capability counter, collapse toggle —
 * and surfaces the active persona so the user can see what scope they're
 * speaking from. The actual chat surface is unchanged: this is just a
 * presentational frame.
 */
@Component({
  selector: 'app-chat-rail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChatShellComponent, IconComponent],
  template: `
    <aside class="rail" [class.collapsed]="collapsed()">
      @if (collapsed()) {
        <button type="button" class="reopen" (click)="toggle()" aria-label="Open coordinator">
          <svg-icon name="message" [size]="20" />
          <span class="vlabel">Coordinator</span>
        </button>
      } @else {
        <header>
          <div class="title">
            <span class="dot"></span>
            <div>
              <strong>Matter Coordinator</strong>
              <span class="sub">{{ specialistsLabel() }}</span>
            </div>
          </div>
          <div class="actions">
            <span class="caps" [attr.title]="capsTitle()">
              <svg-icon name="bolt" [size]="13" /> {{ toolCount() }}
            </span>
            <button type="button" class="icon-btn" (click)="toggle()" aria-label="Collapse">
              <svg-icon name="chevron-right" [size]="16" />
            </button>
          </div>
        </header>
        <div class="persona-strip">
          <svg-icon name="users" [size]="13" />
          <span>Speaking as <strong>{{ persona() }}</strong> · {{ persona() === 'lead-counsel' ? 'full access' : 'scoped tools' }}</span>
        </div>
        <div class="hints">
          <p class="hint-title">Try asking</p>
          <ul>
            <li>"Add Sarah Chen as a custodian on this matter"</li>
            <li>"Find documents about Project Phoenix"</li>
            <li>"Mark DOC-7891236 as attorney-client privileged"</li>
            <li>"Show pending hold acknowledgements"</li>
          </ul>
        </div>
        <div class="chat-host"><mvk-chat-shell /></div>
      }
    </aside>
  `,
  styles: `
    .rail {
      width: var(--chat-w); flex-shrink: 0;
      background: var(--c-surface-0);
      border-left: 1px solid var(--c-border);
      display: flex; flex-direction: column;
      min-height: 0;
      transition: width var(--t-med);
    }
    .rail.collapsed { width: 56px; }
    .reopen {
      flex: 1; background: transparent; border: 0; cursor: pointer;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: var(--s-3); color: var(--c-text-mute);
      transition: color var(--t-fast), background var(--t-fast);
    }
    .reopen:hover { color: var(--c-brand); background: var(--c-surface-1); }
    .vlabel {
      writing-mode: vertical-rl; transform: rotate(180deg);
      font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;
    }

    header {
      display: flex; align-items: center; justify-content: space-between;
      padding: var(--s-4) var(--s-4) var(--s-3);
      border-bottom: 1px solid var(--c-divider);
    }
    .title { display: flex; align-items: center; gap: var(--s-3); }
    .title strong { display: block; font-size: var(--fs-sm); font-weight: 600; }
    .title .sub { font-size: 0.7rem; color: var(--c-text-mute); }
    .dot {
      width: 9px; height: 9px; border-radius: 999px;
      background: var(--c-ok); box-shadow: 0 0 0 4px var(--c-ok-soft);
      flex-shrink: 0;
    }
    .actions { display: flex; align-items: center; gap: var(--s-2); }
    .caps {
      display: inline-flex; align-items: center; gap: 0.25rem;
      padding: 2px 8px; background: var(--c-brand-tint); color: var(--c-brand-strong);
      border-radius: var(--r-pill); font-size: 0.7rem; font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .icon-btn {
      width: 28px; height: 28px; padding: 0; background: transparent;
      border: 1px solid transparent; border-radius: var(--r-sm);
      display: inline-flex; align-items: center; justify-content: center;
      color: var(--c-text-mute); cursor: pointer;
    }
    .icon-btn:hover { background: var(--c-surface-2); color: var(--c-text); }

    .persona-strip {
      display: flex; align-items: center; gap: var(--s-2);
      padding: 0.4rem var(--s-4);
      background: var(--c-surface-1);
      border-bottom: 1px solid var(--c-divider);
      font-size: 0.7rem; color: var(--c-text-mute);
    }
    .persona-strip strong { color: var(--c-text); text-transform: capitalize; }

    .hints {
      padding: var(--s-3) var(--s-4) var(--s-2);
    }
    .hint-title {
      margin: 0 0 var(--s-2);
      font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--c-text-faint); font-weight: 600;
    }
    .hints ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
    .hints li {
      padding: 0.35rem 0.55rem;
      background: var(--c-surface-1); border: 1px solid var(--c-border);
      border-radius: var(--r-sm); font-size: 0.78rem; color: var(--c-text-2);
      cursor: pointer; transition: background var(--t-fast), border-color var(--t-fast);
    }
    .hints li:hover { background: var(--c-brand-tint); border-color: var(--c-brand-soft); color: var(--c-brand-strong); }

    .chat-host {
      flex: 1; min-height: 0;
      padding: var(--s-2) var(--s-2) var(--s-3);
      display: flex; flex-direction: column;
    }
    .chat-host mvk-chat-shell { flex: 1; min-height: 0; }
  `,
})
export class ChatRailComponent {
  private readonly toolRegistry = inject(ToolRegistry);
  private readonly capabilityRegistry = inject(CapabilityRegistry);
  private readonly personaService = inject(PersonaService);

  protected readonly toolCount = computed(() => this.toolRegistry.signal().length);
  protected readonly persona = this.personaService.active;
  protected readonly capsTitle = computed(() =>
    `${this.toolCount()} tools registered (Phase 7's permission shim will hide what '${this.persona()}' can't invoke)`,
  );
  protected readonly specialistsLabel = computed(() => {
    const n = this.capabilityRegistry.signal().length;
    return n === 0 ? 'Collection (host)' : `Collection (host) + ${n} federated`;
  });

  protected readonly collapsed = signal(false);
  toggle(): void { this.collapsed.update((v) => !v); }
}
