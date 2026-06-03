import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { DashboardCardComponent, type CardSpec } from './dashboard-card.component';
import { PlanTripFormComponent } from './plan-trip-form.component';
import { AgentComposerComponent } from './agent-composer.component';

/**
 * Mature TravelOps account-management shell. A left sidebar navigates four
 * pages (Overview · Trips · Loyalty · Support); the topbar carries the brand,
 * a search field, a notification bell, and a user avatar. Each page below
 * the Overview is populated entirely by an agent run that returns a rich,
 * list-shaped widget (tripListCard / loyaltyOverviewCard / ticketListCard).
 *
 * No chat surface. The agent is the invisible engine that fills every page.
 */
type RouteId = 'overview' | 'trips' | 'loyalty' | 'support';

interface RouteSpec {
  readonly id: RouteId;
  readonly label: string;
  readonly icon: string;
  /** Empty for the Overview route — it composes multiple cards directly. */
  readonly card?: CardSpec;
  readonly subtitle?: string;
}

const ROUTES: readonly RouteSpec[] = [
  { id: 'overview', label: 'Overview', icon: '◇', subtitle: 'Everything at a glance.' },
  {
    id: 'trips',
    label: 'Trips',
    icon: '✈',
    subtitle: 'Upcoming flights and recent travel.',
    card: { id: 'trips', prompt: 'List my upcoming trips.', skeletonHint: 'Loading trips' },
  },
  {
    id: 'loyalty',
    label: 'Loyalty',
    icon: '★',
    subtitle: 'Points balance, tier, and recent activity.',
    card: { id: 'loyalty', prompt: 'Show my loyalty account.', skeletonHint: 'Loading loyalty' },
  },
  {
    id: 'support',
    label: 'Support',
    icon: '✉',
    subtitle: 'Your recent support tickets.',
    card: { id: 'support', prompt: 'List my support tickets.', skeletonHint: 'Loading tickets' },
  },
];

const OVERVIEW_SECTIONS: ReadonlyArray<{ title: string; cards: readonly CardSpec[] }> = [
  {
    title: 'Upcoming trips',
    cards: [
      { id: 'trip-jfk', prompt: 'Book a flight from LAX to JFK on 2026-06-15.', skeletonHint: 'Loading trip' },
      { id: 'trip-atl', prompt: 'Book a flight from LAX to ATL on 2026-07-04.', skeletonHint: 'Loading trip' },
    ],
  },
  {
    title: 'Account',
    cards: [{ id: 'points', prompt: 'How many loyalty points do I have?', skeletonHint: 'Loading account' }],
  },
  {
    title: 'Open support',
    cards: [{
      id: 'ticket',
      prompt: 'Open a support ticket: my refund has not arrived. Priority high.',
      skeletonHint: 'Loading ticket',
    }],
  },
];

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DashboardCardComponent, PlanTripFormComponent, AgentComposerComponent],
  template: `
    <div class="shell">

      <!-- Sidebar nav -->
      <aside class="sidebar" aria-label="Primary navigation">
        <div class="brand">
          <span class="logo">✦</span>
          <strong>TravelOps</strong>
        </div>
        <nav>
          <ul role="list">
            @for (r of routes; track r.id) {
              <li>
                <button
                  type="button"
                  class="nav-item"
                  [class.active]="route() === r.id"
                  [attr.aria-current]="route() === r.id ? 'page' : null"
                  (click)="route.set(r.id)">
                  <span class="nav-icon">{{ r.icon }}</span>
                  <span>{{ r.label }}</span>
                </button>
              </li>
            }
          </ul>
        </nav>
        <div class="sidebar-foot">
          <div class="status-pill"><span class="dot ok"></span> Connected</div>
        </div>
      </aside>

      <!-- Main column -->
      <div class="main">
        <header class="topbar">
          <div class="breadcrumb">
            <span class="muted">Account</span>
            <span class="sep">/</span>
            <span class="current">{{ activeLabel() }}</span>
          </div>
          <div class="topbar-actions">
            <div class="search">
              <span class="ico">⌕</span>
              <input type="search" placeholder="Search bookings, tickets…" aria-label="Search">
              <span class="kbd">⌘K</span>
            </div>
            <button type="button" class="icon-btn" aria-label="Notifications">
              <span>🔔</span>
              <span class="badge">3</span>
            </button>
            <span class="avatar" aria-hidden="true">SS</span>
          </div>
        </header>

        <main class="page">
          @switch (route()) {

            @case ('overview') {
              <section class="hero">
                <h1>Welcome back, Sahas</h1>
                <p>Here's what's happening with your account.</p>
              </section>

              <app-plan-trip-form />

              @for (section of overviewSections; track section.title) {
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

              <app-agent-composer />
            }

            @default {
              <section class="hero">
                <h1>{{ activeLabel() }}</h1>
                <p>{{ activeSubtitle() }}</p>
              </section>

              @if (activeCard(); as card) {
                <div class="page-card">
                  <app-dashboard-card [card]="card" [refreshTick]="refreshTick()" />
                </div>
              }
            }

          }
        </main>
      </div>

    </div>
  `,
  styles: `
    :host { display: block; min-height: 100vh; background: var(--bg); }
    .shell { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }

    /* ── Sidebar ──────────────────────────────────────────────────────── */
    .sidebar {
      background: var(--surface);
      border-right: 1px solid var(--border);
      display: grid; grid-template-rows: auto 1fr auto;
      gap: 1rem;
      padding: 1rem 0.85rem;
    }
    .brand { display: flex; gap: 0.55rem; align-items: center; padding: 0.25rem 0.4rem; }
    .brand .logo {
      width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
      background: linear-gradient(135deg, var(--primary), #06b6d4); color: #fff; border-radius: 7px; font-weight: 700;
    }
    nav ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.15rem; }
    .nav-item {
      display: flex; align-items: center; gap: 0.55rem;
      width: 100%; padding: 0.45rem 0.55rem;
      background: transparent; border: 1px solid transparent; border-radius: var(--r-sm);
      font: inherit; font-size: 0.9em; color: var(--text);
      text-align: left;
    }
    .nav-item:hover { background: #f8fafc; }
    .nav-item.active { background: #eef2ff; color: #4338ca; font-weight: 600; }
    .nav-icon { width: 18px; text-align: center; font-size: 1em; }
    .sidebar-foot { padding: 0 0.4rem; }
    .status-pill { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.25rem 0.55rem; background: #ecfdf5; border-radius: 999px; font-size: 0.72em; color: #065f46; font-weight: 600; }
    .dot { width: 7px; height: 7px; border-radius: 50%; }
    .dot.ok { background: var(--success); }

    /* ── Main column ──────────────────────────────────────────────────── */
    .main { display: grid; grid-template-rows: auto 1fr; min-width: 0; }
    .topbar {
      display: flex; align-items: center; justify-content: space-between; gap: 1rem;
      padding: 0.6rem 1.25rem;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
    }
    .breadcrumb { font-size: 0.9em; }
    .breadcrumb .sep { margin: 0 0.4rem; color: var(--muted); }
    .breadcrumb .current { font-weight: 600; }
    .muted { color: var(--muted); }

    .topbar-actions { display: flex; align-items: center; gap: 0.6rem; }
    .search {
      display: inline-flex; align-items: center; gap: 0.4rem;
      padding: 0.35rem 0.7rem;
      background: var(--bg);
      border: 1px solid var(--border); border-radius: 999px;
      font-size: 0.85em; color: var(--muted);
      min-width: 260px;
    }
    .search input { border: 0; background: transparent; font: inherit; flex: 1 1 auto; outline: none; color: var(--text); }
    .search .ico { font-size: 1em; }
    .search .kbd { font-family: ui-monospace, monospace; font-size: 0.75em; padding: 1px 5px; border-radius: 3px; background: var(--code-bg); color: var(--muted); }

    .icon-btn {
      position: relative;
      width: 34px; height: 34px;
      border: 1px solid var(--border); border-radius: 50%;
      background: var(--surface);
      display: inline-flex; align-items: center; justify-content: center;
    }
    .icon-btn:hover { background: #f8fafc; }
    .icon-btn .badge {
      position: absolute; top: -3px; right: -3px;
      min-width: 18px; height: 18px; padding: 0 4px; border-radius: 999px;
      background: var(--error); color: #fff;
      font-size: 0.65em; font-weight: 700;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .avatar {
      width: 34px; height: 34px;
      display: inline-flex; align-items: center; justify-content: center;
      background: #e0e7ff; color: #3730a3;
      border-radius: 50%; font-size: 0.78em; font-weight: 700; letter-spacing: 0.02em;
    }

    .page {
      max-width: 1100px; width: 100%; margin: 0 auto;
      padding: 1.6rem 1.5rem 3rem;
      display: grid; gap: 1.5rem;
      min-width: 0;
    }
    .hero h1 { margin: 0 0 0.2rem; font-size: 1.55rem; font-weight: 700; letter-spacing: -0.01em; }
    .hero p { margin: 0; color: var(--muted); }

    .block { display: grid; gap: 0.7rem; }
    .block h2 { margin: 0; font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 600; }
    .cards { display: grid; gap: 0.9rem; }
    .cards[data-count='1'] { grid-template-columns: 1fr; }
    .cards[data-count='2'] { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    .card { min-width: 0; }
    .page-card { min-width: 0; }

    @media (max-width: 760px) {
      .shell { grid-template-columns: 1fr; }
      .sidebar { display: none; }
      .search { min-width: 0; flex: 1 1 auto; }
    }
  `,
})
export class App {
  protected readonly routes = ROUTES;
  protected readonly overviewSections = OVERVIEW_SECTIONS;
  protected readonly route = signal<RouteId>('overview');
  protected readonly refreshTick = signal(0);

  protected activeLabel(): string {
    return this.routes.find((r) => r.id === this.route())?.label ?? 'Overview';
  }
  protected activeSubtitle(): string {
    return this.routes.find((r) => r.id === this.route())?.subtitle ?? '';
  }
  protected activeCard(): CardSpec | undefined {
    return this.routes.find((r) => r.id === this.route())?.card;
  }
}
