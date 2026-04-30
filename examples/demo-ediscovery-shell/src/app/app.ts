import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './layout/header.component';
import { SidebarComponent } from './layout/sidebar.component';
import { ChatRailComponent } from './layout/chat-rail.component';

/**
 * Root shell. Three-pane chassis:
 *  - Left rail: persistent navigation
 *  - Main: header + routed content (dashboard / documents / etc.)
 *  - Right rail: collapsible matter coordinator chat
 */
@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, HeaderComponent, SidebarComponent, ChatRailComponent],
  template: `
    <div class="shell">
      <app-sidebar />
      <div class="col">
        <app-header />
        <main><router-outlet /></main>
      </div>
      <app-chat-rail />
    </div>
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
export class App {}
