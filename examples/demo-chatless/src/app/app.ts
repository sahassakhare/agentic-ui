import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { DashboardCardComponent, type CardSpec } from './dashboard-card.component';
import { PlanTripFormComponent } from './plan-trip-form.component';

/**
 * The product dashboard. The cards on this page are filled by the agent on
 * mount — the user just sees their account at a glance. The agent's
 * involvement is invisible: no chat surface, no prompts, no tool traces,
 * no status pills. This is CopilotKit's "chatless / generative UI
 * integrated into application UI" pattern.
 *
 * Each card spec carries a hidden prompt the app sends through the agent
 * backend; the agent picks the matching tool from `ToolRegistry`, the
 * resulting widget is the card's content via `<mvk-widget-container>`.
 */
interface SectionSpec {
  readonly title: string;
  readonly cards: readonly CardSpec[];
}

const SECTIONS: readonly SectionSpec[] = [
  {
    title: 'Upcoming trips',
    cards: [
      { id: 'trip-jfk', prompt: 'Book a flight from LAX to JFK on 2026-06-15.', skeletonHint: 'Loading trip' },
      { id: 'trip-atl', prompt: 'Book a flight from LAX to ATL on 2026-07-04.', skeletonHint: 'Loading trip' },
    ],
  },
  {
    title: 'Account',
    cards: [
      { id: 'points', prompt: 'How many loyalty points do I have?', skeletonHint: 'Loading account' },
    ],
  },
  {
    title: 'Open support',
    cards: [
      {
        id: 'ticket',
        prompt: 'Open a support ticket: my refund has not arrived. Priority high.',
        skeletonHint: 'Loading ticket',
      },
    ],
  },
];

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DashboardCardComponent, PlanTripFormComponent],
  template: `
    <div class="shell">
      <header class="topbar">
        <div class="brand">
          <span class="logo">✦</span>
          <strong>TravelOps</strong>
        </div>
        <div class="actions">
          <button type="button" class="refresh" (click)="refresh()" aria-label="Refresh dashboard">
            <span class="ico">↻</span><span class="label">Refresh</span>
          </button>
          <span class="avatar" aria-hidden="true">SS</span>
        </div>
      </header>

      <main class="page">
        <section class="hero">
          <h1>Welcome back</h1>
          <p>Here's what's happening with your account.</p>
        </section>

        <app-plan-trip-form />

        @for (section of sections; track section.title) {
          <section class="block">
            <h2>{{ section.title }}</h2>
            <div class="cards" [attr.data-count]="section.cards.length">
              @for (card of section.cards; track card.id) {
                <div class="card">
                  <app-dashboard-card [card]="card" [refreshTick]="refreshTick()" />
                </div>
              }
            </div>
          </section>
        }
      </main>
    </div>
  `,
  styles: `
    :host { display: block; min-height: 100vh; background: var(--bg); }
    .shell { display: grid; grid-template-rows: auto 1fr; min-height: 100vh; }

    .topbar {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.7rem 1.5rem;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }
    .brand { display: flex; align-items: center; gap: 0.55rem; font-size: 1.05rem; }
    .brand .logo {
      display: inline-flex; width: 28px; height: 28px; align-items: center; justify-content: center;
      background: linear-gradient(135deg, var(--primary), #06b6d4);
      color: #fff; border-radius: 7px; font-weight: 700;
    }
    .actions { display: flex; align-items: center; gap: 0.9rem; }
    .refresh {
      display: inline-flex; align-items: center; gap: 0.35rem;
      padding: 0.4rem 0.75rem;
      border: 1px solid var(--border); border-radius: 999px;
      background: var(--surface); color: var(--text);
      font-size: 0.85em;
    }
    .refresh:hover { background: #f8fafc; }
    .refresh .ico { font-size: 1em; line-height: 1; }
    .avatar {
      width: 32px; height: 32px;
      display: inline-flex; align-items: center; justify-content: center;
      background: #e0e7ff; color: #3730a3;
      border-radius: 50%;
      font-size: 0.75em; font-weight: 700; letter-spacing: 0.02em;
    }

    .page {
      max-width: 980px; width: 100%; margin: 0 auto;
      padding: 2rem 1.5rem 3rem;
      display: grid; gap: 1.75rem;
    }
    .hero h1 { margin: 0 0 0.2rem; font-size: 1.6rem; font-weight: 700; letter-spacing: -0.01em; }
    .hero p { margin: 0; color: var(--muted); }

    .block { display: grid; gap: 0.7rem; }
    .block h2 {
      margin: 0; font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.06em;
      color: var(--muted); font-weight: 600;
    }
    .cards { display: grid; gap: 0.9rem; }
    .cards[data-count='1'] { grid-template-columns: 1fr; }
    .cards[data-count='2'] { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    .card { min-width: 0; }
  `,
})
export class App {
  protected readonly sections = SECTIONS;
  protected readonly refreshTick = signal(0);

  protected refresh(): void {
    this.refreshTick.update((n) => n + 1);
  }
}
