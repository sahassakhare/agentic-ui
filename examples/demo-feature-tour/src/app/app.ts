import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ChatShellComponent } from '@infra-tools/agentic-ui';
import { ToastService } from './services/toast.service';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, RouterOutlet, ChatShellComponent],
  template: `
    <header>
      <strong>demo-feature-tour</strong>
      <nav>
        <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{exact:true}">Home</a>
        <a routerLink="/dashboard" routerLinkActive="active">Dashboard</a>
        <a routerLink="/profile" routerLinkActive="active">Profile</a>
      </nav>
    </header>

    <main>
      <section class="content"><router-outlet /></section>
      <aside class="chat">
        <h3>Chat</h3>
        <mvk-chat-shell />
      </aside>
    </main>

    <!-- Toasts dispatched by the showToast action surface here. -->
    @if (toasts().length > 0) {
      <div class="toasts">
        @for (t of toasts(); track t.id) {
          <div class="toast" [class]="'toast--' + t.level">{{ t.message }}</div>
        }
      </div>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100vh; }
    header { display: flex; gap: 1.2rem; padding: 0.6rem 1.2rem; background: #fff; border-bottom: 1px solid #e2e8f0; align-items: center; }
    header strong { font-size: 0.95rem; }
    nav { display: flex; gap: 0.6rem; }
    nav a { padding: 0.25rem 0.6rem; color: #475569; border-radius: 4px; text-decoration: none; font-size: 0.9rem; }
    nav a:hover { background: #f1f5f9; }
    nav a.active { background: #e0e7ff; color: #3730a3; font-weight: 500; }

    main { display: grid; grid-template-columns: minmax(0, 1fr) 380px; flex: 1; min-height: 0; gap: 0; }
    .content { padding: 1.2rem 1.6rem; overflow: auto; }
    .chat { padding: 0.8rem; border-left: 1px solid #e2e8f0; background: #fff; display: flex; flex-direction: column; min-height: 0; }
    .chat h3 { margin: 0 0 0.4rem; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; }
    .chat mvk-chat-shell { flex: 1; min-height: 0; }

    .toasts { position: fixed; bottom: 1rem; right: 1rem; display: flex; flex-direction: column; gap: 0.4rem; z-index: 1000; }
    .toast { padding: 0.6rem 1rem; border-radius: 0.4rem; color: white; font-size: 0.85rem; min-width: 200px; box-shadow: 0 4px 12px rgba(15,23,42,0.15); }
    .toast--info { background: #2563eb; }
    .toast--success { background: #16a34a; }
    .toast--warn { background: #d97706; }
  `,
})
export class App {
  private readonly toastService = inject(ToastService);
  protected readonly toasts = computed(() => this.toastService.toasts());
}
