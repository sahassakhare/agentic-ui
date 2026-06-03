import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { WorkspaceLayoutComponent } from '@infra-tools/agentic-ui';
import type { WorkspaceSlots } from './workspace-wrapper.component';

interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
}

interface ShellDef {
  readonly brand: string;
  readonly tagline?: string;
  readonly navItems: readonly NavItem[];
  readonly mainSlots: WorkspaceSlots;
}

/**
 * Renders an LLM-emitted entire app shell — brand + sidebar nav + main
 * column with workspace slots. The host swaps this in when the user
 * activates "agent shell" mode; the user navigates between agent-emitted
 * nav items (currently just an active-id signal; richer routing would
 * need a second LLM call per nav click).
 */
@Component({
  selector: 'app-agent-shell-wrapper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [WorkspaceLayoutComponent],
  template: `
    <div class="agent-shell">
      <aside class="sidebar">
        <div class="brand">
          <span class="logo">✦</span>
          <strong>{{ shell().brand }}</strong>
          @if (shell().tagline; as tag) { <span class="tag">{{ tag }}</span> }
        </div>
        <nav>
          <ul role="list">
            @for (n of shell().navItems; track n.id) {
              <li>
                <button
                  type="button"
                  class="nav-item"
                  [class.active]="activeNav() === n.id"
                  (click)="activeNav.set(n.id)">
                  @if (n.icon) { <span class="ico">{{ n.icon }}</span> }
                  <span>{{ n.label }}</span>
                </button>
              </li>
            }
          </ul>
        </nav>
        <div class="footer">
          <span class="badge">agent-generated</span>
        </div>
      </aside>
      <main class="main">
        <mvk-workspace-layout [slots]="cast(shell().mainSlots)" />
      </main>
    </div>
  `,
  styles: `
    :host { display: block; }
    .agent-shell {
      display: grid; grid-template-columns: 220px 1fr;
      border: 1px solid var(--border); border-radius: var(--r); overflow: hidden;
      background: var(--bg); box-shadow: var(--shadow);
      min-height: 360px;
    }
    .sidebar {
      background: var(--surface);
      display: grid; grid-template-rows: auto 1fr auto;
      gap: 0.85rem; padding: 0.85rem 0.75rem;
      border-right: 1px solid var(--border);
    }
    .brand { display: grid; gap: 0.15rem; padding: 0.2rem 0.3rem; }
    .brand strong { font-size: 0.95em; }
    .brand .logo {
      width: 24px; height: 24px;
      display: inline-flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, var(--primary), #06b6d4);
      color: #fff; border-radius: 5px; font-weight: 700; font-size: 0.85em;
    }
    .brand .tag { color: var(--muted); font-size: 0.75em; }

    nav ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.15rem; }
    .nav-item {
      display: flex; align-items: center; gap: 0.5rem; width: 100%;
      padding: 0.4rem 0.55rem; background: transparent; border: 1px solid transparent;
      border-radius: var(--r-sm); font: inherit; font-size: 0.88em; text-align: left;
    }
    .nav-item:hover { background: #f8fafc; }
    .nav-item.active { background: #eef2ff; color: #4338ca; font-weight: 600; }
    .nav-item .ico { width: 16px; text-align: center; }

    .footer { padding: 0.2rem 0.3rem; }
    .badge {
      display: inline-block; padding: 0.2rem 0.55rem; font-size: 0.7em; font-weight: 600;
      background: #fef3c7; color: #92400e; border-radius: 999px;
      text-transform: uppercase; letter-spacing: 0.05em;
    }

    .main { padding: 0.85rem; }
    .main mvk-workspace-layout { min-height: 280px; }
  `,
})
export class AgentShellWrapperComponent {
  readonly shell = input.required<ShellDef>();
  protected readonly activeNav = signal<string>('');

  protected readonly _ = computed(() => {
    // On first render, default the active nav to the first item.
    const first = this.shell().navItems[0]?.id ?? '';
    if (!this.activeNav()) this.activeNav.set(first);
    return null;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected cast(s: WorkspaceSlots): any { return s; }
}
