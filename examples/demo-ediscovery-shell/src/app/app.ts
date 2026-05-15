import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { SelectionStore } from '@infra-tools/agentic-ui';
import { HeaderComponent } from './layout/header.component';
import { SidebarComponent } from './layout/sidebar.component';
import { ChatRailComponent } from './layout/chat-rail.component';
import { CommandPaletteComponent } from './ui/command-palette.component';

/**
 * Root shell. Three-pane chassis:
 *  - Left rail: persistent navigation
 *  - Main: header + routed content (dashboard / documents / etc.)
 *  - Right rail: collapsible matter coordinator chat
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, HeaderComponent, SidebarComponent, ChatRailComponent, CommandPaletteComponent],
  template: `
    <div class="shell">
      <app-sidebar />
      <div class="col">
        <app-header />
        <main><router-outlet /></main>
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
  `,
})
export class App {
  // ADR-047 D7 — clear the global selection on every navigation. Each
  // page that wants to drive selection-based layouts sets the store on
  // row click; cross-route navigation tears it down so the resolver
  // doesn't get stale data on the next page. Subscription lives for
  // the app lifetime — root component never destroys.
  private readonly selectionStore = inject(SelectionStore);

  constructor() {
    inject(Router).events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => this.selectionStore.clear());
  }
}
