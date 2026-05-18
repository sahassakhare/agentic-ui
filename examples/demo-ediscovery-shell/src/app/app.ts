import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import {
  LayoutResolver,
  SelectionStore,
  WorkspaceLayoutComponent,
} from '@infra-tools/agentic-ui';
import { HeaderComponent } from './layout/header.component';
import { SidebarComponent } from './layout/sidebar.component';
import { ChatRailComponent } from './layout/chat-rail.component';
import { CommandPaletteComponent } from './ui/command-palette.component';
import { WorkspaceLayoutStore } from './services/workspace-layout.store';

/**
 * Root shell. Three-pane chassis:
 *  - Left rail: persistent navigation
 *  - Main: header + (router content OR agent-driven layout overlay)
 *  - Right rail: collapsible matter coordinator chat
 *
 * Agent overlay scope: when the agent has emitted a SlotMap via
 * setWorkspaceLayout (or a slot-edit tool), the main viewport renders
 * the resolved `<mvk-workspace-layout>` in place of the routed content
 * ONLY on `/workspace`. Other routes (Dashboards, Documents, Holds,
 * Audit, …) render their normal page content; side-menu navigation
 * stays predictable. The agent state persists across navigation, so
 * returning to `/workspace` shows the overlay again. Reset on the
 * banner clears the agent layer.
 *
 * Earlier iteration: the overlay covered every route. Reviewers found
 * that confusing — every side-menu click showed the same canvas. Route-
 * scoping `/workspace` is the agreed compromise (matches the slash-
 * route name + the agent's tool description that says "/workspace").
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    HeaderComponent,
    SidebarComponent,
    ChatRailComponent,
    CommandPaletteComponent,
    WorkspaceLayoutComponent,
  ],
  template: `
    <div class="shell">
      <app-sidebar />
      <div class="col">
        <app-header />
        <main>
          @if (agentOverlayActive()) {
            <div class="agent-overlay-banner">
              <span class="dot" aria-hidden="true">●</span>
              <strong>Agent-driven layout active</strong>
              <span class="dim">— this canvas is replacing the routed page until you reset.</span>
              <button type="button" class="reset" (click)="resetAgentLayout()">Reset</button>
            </div>
            <div class="agent-overlay-canvas">
              <mvk-workspace-layout
                [slots]="resolvedSlots()"
                layoutName="ediscovery-agent-overlay" />
            </div>
          } @else {
            <router-outlet />
          }
        </main>
      </div>
      <app-chat-rail />
    </div>
    <!-- Cmd/Ctrl+K palette (plan R4). Lives at the root so the
         hotkey works on every route; renders nothing when closed. -->
    <mvk-command-palette />
  `,
  styles: `
    :host { display: block; height: 100vh; }
    .shell { display: flex; height: 100%; min-height: 0; }
    .col { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
    main {
      flex: 1; min-height: 0;
      overflow-y: auto;
      padding: var(--s-6) var(--s-8);
    }
    .agent-overlay-banner {
      display: flex; align-items: center; gap: var(--s-3);
      padding: var(--s-3) var(--s-4); margin-bottom: var(--s-3);
      background: var(--c-info-soft, #dbeafe);
      border: 1px solid var(--c-info, #0284c7);
      border-left-width: 4px; border-radius: var(--r-md);
      font-size: var(--fs-sm);
    }
    .agent-overlay-banner .dot { color: var(--c-info, #0284c7); font-size: 0.9rem; }
    .agent-overlay-banner strong { color: var(--c-text-1); }
    .agent-overlay-banner .dim { color: var(--c-text-2); }
    .agent-overlay-banner .reset {
      margin-left: auto; padding: 0.35rem 0.85rem;
      background: var(--c-surface); border: 1px solid var(--c-border);
      border-radius: var(--r-md); font-size: var(--fs-xs); cursor: pointer;
    }
    .agent-overlay-banner .reset:hover { background: var(--c-surface-1); border-color: var(--c-accent, #6366f1); }
    .agent-overlay-canvas {
      min-height: calc(100% - 80px);
      border: 1px solid var(--c-border);
      border-radius: var(--r-md);
      padding: var(--s-3);
      background: var(--c-surface);
    }
  `,
})
export class App {
  // ADR-047 D7 — clear the global selection on every navigation. Each
  // page that wants to drive selection-based layouts sets the store on
  // row click; cross-route navigation tears it down so the resolver
  // doesn't get stale data on the next page. Subscription lives for
  // the app lifetime — root component never destroys.
  private readonly selectionStore = inject(SelectionStore);
  private readonly workspaceLayoutStore = inject(WorkspaceLayoutStore);
  private readonly resolver = inject(LayoutResolver);
  private readonly router = inject(Router);

  /**
   * Current route, kept as a signal so the overlay-active computed can
   * gate on it. Seeded from the router's initial URL (NavigationEnd
   * doesn't fire for the boot navigation if the URL is `/`).
   */
  private readonly currentUrl = signal<string>(this.router.url);

  /**
   * True when the agent has emitted a SlotMap AND the user is on
   * /workspace. Other routes (Dashboards, Documents, Audit, …) keep
   * rendering their normal page content even when the agent layer is
   * non-empty — clicking back to /workspace surfaces the overlay
   * again. Reset clears the agent layer.
   */
  protected readonly agentOverlayActive = computed(() => {
    const slots = this.workspaceLayoutStore.slots();
    if (slots === null || Object.keys(slots).length === 0) return false;
    return this.currentUrl().split('?')[0].startsWith('/workspace');
  });

  /**
   * The fully-resolved SlotMap from the LayoutResolver (merges agent +
   * route + persona + matter-phase + selection + user-saved layers).
   * Read by the overlay <mvk-workspace-layout>.
   */
  protected readonly resolvedSlots = computed(() => this.resolver.active().slots);

  protected resetAgentLayout(): void {
    this.workspaceLayoutStore.clear();
  }

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        this.selectionStore.clear();
        this.currentUrl.set(e.urlAfterRedirects);
      });
  }
}
