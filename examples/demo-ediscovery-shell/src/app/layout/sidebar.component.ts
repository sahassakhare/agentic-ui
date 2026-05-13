import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import {
  ApprovalRegistry,
  CapabilityRegistry,
  DashboardRegistry,
  OperationRegistry,
  PlaybookRegistry,
  ToolRegistry,
} from '@infra-tools/agentic-ui';
import { NotificationsStore } from '../services/notifications.store';
import { PersonaService } from '../services/persona.service';
import { IconComponent, type IconName } from '../ui/icon.component';

interface NavItem {
  readonly path: string;
  readonly label: string;
  readonly icon: IconName;
  readonly badge?: () => number | null;
  readonly disabled?: boolean;
}

/**
 * Persistent left-rail navigation. Brand at top, primary domain links,
 * a divider, then a "registries snapshot" footer that reads counts
 * from the host's signal-backed `ToolRegistry` and `CapabilityRegistry`
 * — gives the demo viewer a glanceable readout that the federation
 * actually loaded.
 */
@Component({
  selector: 'app-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, IconComponent],
  template: `
    <aside class="rail">
      <div class="brand">
        <span class="logo"><svg-icon name="shield" [size]="18" /></span>
        <div class="brand-label">
          <strong>Maverick</strong>
          <span>eDiscovery</span>
        </div>
      </div>

      <nav>
        @for (item of items; track item.path) {
          <a
            [routerLink]="item.path"
            routerLinkActive="active"
            [routerLinkActiveOptions]="{ exact: item.path === '/' }"
            class="nav-link"
            [class.disabled]="item.disabled"
          >
            <svg-icon [name]="item.icon" [size]="17" />
            <span>{{ item.label }}</span>
            @if (item.badge && item.badge(); as n) {
              <span class="badge">{{ n }}</span>
            }
          </a>
        }
      </nav>

      <footer>
        <div class="block">
          <span class="lbl">Capabilities loaded</span>
          <div class="rows">
            <div><strong>{{ tools() }}</strong> tools</div>
            <div><strong>{{ remotes() }}</strong> remotes</div>
          </div>
          <ul class="remote-list">
            @for (r of remoteList(); track r) {
              <li><span class="dot"></span>{{ r }}</li>
            } @empty {
              <li class="muted">none</li>
            }
          </ul>
        </div>
      </footer>
    </aside>
  `,
  styles: `
    .rail {
      width: var(--sidebar-w); flex-shrink: 0;
      background: var(--c-surface-0);
      border-right: 1px solid var(--c-border);
      display: flex; flex-direction: column;
      height: 100vh; position: sticky; top: 0;
    }
    .brand {
      height: var(--header-h);
      padding: 0 var(--s-4);
      display: flex; align-items: center; gap: var(--s-3);
      border-bottom: 1px solid var(--c-border);
    }
    .logo {
      width: 30px; height: 30px;
      display: inline-flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, var(--c-brand) 0%, #818cf8 100%);
      color: white; border-radius: var(--r-md);
    }
    .brand-label { line-height: 1.1; }
    .brand-label strong { display: block; font-size: var(--fs-base); letter-spacing: -0.01em; }
    .brand-label span {
      font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em;
      color: var(--c-brand); font-weight: 600;
    }
    nav { padding: var(--s-3); display: flex; flex-direction: column; gap: 2px; flex: 1; overflow-y: auto; }
    .nav-link {
      display: flex; align-items: center; gap: var(--s-3);
      padding: 0.5rem 0.7rem;
      font-size: var(--fs-sm); font-weight: 500;
      color: var(--c-text-2);
      border-radius: var(--r-md);
      transition: background var(--t-fast), color var(--t-fast);
    }
    .nav-link:hover { background: var(--c-surface-2); text-decoration: none; }
    .nav-link.active {
      background: var(--c-brand-tint); color: var(--c-brand-strong);
    }
    .nav-link.disabled {
      pointer-events: none; color: var(--c-text-faint);
    }
    .nav-link svg-icon { color: inherit; }
    .nav-link .badge {
      margin-left: auto;
      padding: 0 7px; min-width: 18px; height: 18px;
      display: inline-flex; align-items: center; justify-content: center;
      background: var(--c-brand); color: white;
      border-radius: var(--r-pill);
      font-size: 0.65rem; font-weight: 600;
    }
    footer {
      padding: var(--s-3) var(--s-4) var(--s-4);
      border-top: 1px solid var(--c-border);
      font-size: var(--fs-xs); color: var(--c-text-mute);
    }
    .lbl { display: block; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--c-text-faint); margin-bottom: var(--s-2); }
    .rows { display: flex; gap: var(--s-3); margin-bottom: var(--s-2); }
    .rows strong { color: var(--c-text); font-size: var(--fs-sm); font-variant-numeric: tabular-nums; }
    .remote-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
    .remote-list li { display: flex; align-items: center; gap: var(--s-2); font-size: var(--fs-xs); }
    .remote-list .dot { width: 6px; height: 6px; border-radius: 999px; background: var(--c-ok); flex-shrink: 0; }
    .remote-list .muted { color: var(--c-text-faint); font-style: italic; }
  `,
})
export class SidebarComponent {
  private readonly toolRegistry = inject(ToolRegistry);
  private readonly capabilityRegistry = inject(CapabilityRegistry);
  private readonly approvalRegistry = inject(ApprovalRegistry);
  private readonly operationRegistry = inject(OperationRegistry);
  private readonly dashboardRegistry = inject(DashboardRegistry);
  private readonly playbookRegistry = inject(PlaybookRegistry);
  private readonly notifications = inject(NotificationsStore);
  private readonly persona = inject(PersonaService);

  protected readonly tools = computed(() => this.toolRegistry.signal().length);
  protected readonly remotes = computed(() => this.capabilityRegistry.signal().length);
  protected readonly remoteList = computed(() => this.capabilityRegistry.signal().map((c) => c.remoteName));

  /**
   * Pending approvals routed to the active persona — used as the
   * `Approvals` nav badge so reviewers see the queue depth at a glance.
   */
  private readonly pendingForMe = computed(
    () => this.approvalRegistry.pendingForApprover(this.persona.active()).length,
  );

  /** Active (started + progress) operations — used as the Operations nav badge. */
  private readonly activeOps = computed(() => this.operationRegistry.active().length);

  protected readonly items: readonly NavItem[] = [
    { path: '/', label: 'Dashboard', icon: 'dashboard' },
    { path: '/documents', label: 'Documents', icon: 'documents' },
    { path: '/custodians', label: 'Custodians', icon: 'users' },
    { path: '/holds', label: 'Legal Holds', icon: 'shield' },
    { path: '/audit', label: 'Audit Trail', icon: 'audit' },
    { path: '/productions', label: 'Productions', icon: 'archive' },
    {
      path: '/approvals',
      label: 'Approvals',
      icon: 'circle-check',
      badge: () => {
        const n = this.pendingForMe();
        return n > 0 ? n : null;
      },
    },
    {
      path: '/operations',
      label: 'Operations',
      icon: 'bolt',
      badge: () => {
        const n = this.activeOps();
        return n > 0 ? n : null;
      },
    },
    // ── Post-chat surfaces (P2 / P3 / P5) ────────────────────────────
    {
      path: '/inbox',
      label: 'Inbox',
      icon: 'audit',
      badge: () => {
        const n = this.notifications.unreadCount();
        return n > 0 ? n : null;
      },
    },
    {
      path: '/dashboards',
      label: 'Dashboards',
      icon: 'dashboard',
      badge: () => {
        const n = this.dashboardRegistry.signal().length;
        return n > 0 ? n : null;
      },
    },
    {
      path: '/playbooks',
      label: 'Playbooks',
      icon: 'audit',
      badge: () => {
        const n = this.playbookRegistry.signal().length;
        return n > 0 ? n : null;
      },
    },
    // ── Workflow surfaces (P4) ───────────────────────────────────────
    { path: '/review-queue', label: 'Review queue', icon: 'circle-check' },
    { path: '/timeline',     label: 'Timeline',     icon: 'audit' },
    { path: '/cal',          label: 'CAL workbench', icon: 'bolt' },
    // ── Workspace layout demo (P0 / §17) ─────────────────────────────
    { path: '/workspace',    label: 'Workspace',    icon: 'dashboard' },
  ];
}
