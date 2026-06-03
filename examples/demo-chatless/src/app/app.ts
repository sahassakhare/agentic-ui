import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { WidgetContainerComponent } from '@infra-tools/agentic-ui';
import { DashboardCardComponent, type CardSpec } from './dashboard-card.component';
import { PlanTripFormComponent } from './plan-trip-form.component';
import { ComposerControlComponent } from './composer-control.component';
import { ComposerService } from './services/composer.service';

/**
 * App-wide shell with an agent composer wired into the topbar as a real
 * capability — not a sandbox.
 *
 *  - `ComposerService.compose(mode)` fires the agent.
 *  - When the service's `target` is `'page'`, the active route's main
 *    column is replaced by the composer's widgets.
 *  - When the service's `target` is `'shell'`, the entire app shell is
 *    replaced (the LLM-emitted `<app-agent-shell-wrapper>` takes over).
 *  - "↺ Restore default" in the dropdown reverts to the standard UI.
 */
type RouteId = 'overview' | 'trips' | 'loyalty' | 'support';

interface RouteSpec {
  readonly id: RouteId;
  readonly label: string;
  readonly icon: string;
  readonly card?: CardSpec;
  readonly subtitle?: string;
}

const ROUTES: readonly RouteSpec[] = [
  { id: 'overview', label: 'Overview', icon: '◇', subtitle: 'Everything at a glance.' },
  {
    id: 'trips', label: 'Trips', icon: '✈',
    subtitle: 'Upcoming flights and recent travel.',
    card: { id: 'trips', prompt: 'List my upcoming trips.', skeletonHint: 'Loading trips' },
  },
  {
    id: 'loyalty', label: 'Loyalty', icon: '★',
    subtitle: 'Points balance, tier, and recent activity.',
    card: { id: 'loyalty', prompt: 'Show my loyalty account.', skeletonHint: 'Loading loyalty' },
  },
  {
    id: 'support', label: 'Support', icon: '✉',
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
  imports: [DashboardCardComponent, PlanTripFormComponent, ComposerControlComponent, WidgetContainerComponent],
  template: `

    @if (composer.target() === 'shell') {

      <!-- Agent-driven whole-shell takeover (L5). Entire app becomes the
           composer's output; the topbar reduces to the Restore control. -->
      <div class="shell-takeover">
        <div class="takeover-bar">
          <span class="badge">Agent shell active</span>
          @if (composer.activeMode(); as m) {
            <span class="badge-meta">{{ m.tag }} · {{ m.label }}</span>
          }
          <button type="button" class="restore" (click)="composer.clear()">↺ Restore default</button>
        </div>
        <div class="takeover-body">
          @if (composer.error(); as err) {
            <div class="takeover-error">Composition failed: {{ err.message }}</div>
          } @else if (composer.widgets().length > 0) {
            @for (w of composer.widgets(); track w.widgetCallId) {
              <mvk-widget-container [widget]="w" />
            }
          } @else if (composer.isLoading()) {
            <div class="takeover-loading">Composing the shell…</div>
          }
        </div>
      </div>

    } @else {

      <!-- Standard shell. -->
      <div class="shell">

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
              <app-composer-control />
              <button type="button" class="icon-btn" aria-label="Notifications">
                <span>🔔</span>
                <span class="badge">3</span>
              </button>
              <span class="avatar" aria-hidden="true">SS</span>
            </div>
          </header>

          <main class="page">

            @if (composer.target() === 'page') {

              <!-- L1–L4 / L6 — replace the active page's main column with the
                   composer output and offer the layout-channel banner if D fired. -->
              <section class="hero">
                @if (composer.activeMode(); as m) {
                  <h1>{{ m.label }} <span class="hero-tag">{{ m.tag }}</span></h1>
                  <p>{{ m.description }}</p>
                }
              </section>

              @if (composer.lastLayoutEvent(); as ev) {
                <aside class="channel-banner">
                  <span class="dot"></span>
                  <strong>Active layout (channel D):</strong>
                  <code>{{ ev.layoutName }}</code>
                  @if (ev.reason; as r) { <span class="reason">— {{ r }}</span> }
                </aside>
              }

              <div class="composer-output" [attr.data-mode]="composer.activeMode()?.id">
                @if (composer.error(); as err) {
                  <div class="placeholder error">
                    <span class="ico">!</span>
                    <p>This composition is temporarily unavailable.</p>
                  </div>
                } @else if (composer.widgets().length > 0) {
                  @for (w of composer.widgets(); track w.widgetCallId) {
                    <mvk-widget-container [widget]="w" />
                  }
                } @else if (composer.isLoading()) {
                  <div class="skeleton" aria-busy="true">
                    <span class="line w-50"></span>
                    <span class="line w-90"></span>
                    <span class="line w-70"></span>
                  </div>
                }
              </div>

            } @else {

              <!-- Standard route content. -->
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

            }

          </main>
        </div>

      </div>

    }
  `,
  styles: `
    :host { display: block; min-height: 100vh; background: var(--bg); }

    /* ── Standard shell ───────────────────────────────────────────────── */
    .shell { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }

    .sidebar { background: var(--surface); border-right: 1px solid var(--border); display: grid; grid-template-rows: auto 1fr auto; gap: 1rem; padding: 1rem 0.85rem; }
    .brand { display: flex; gap: 0.55rem; align-items: center; padding: 0.25rem 0.4rem; }
    .brand .logo { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; background: linear-gradient(135deg, var(--primary), #06b6d4); color: #fff; border-radius: 7px; font-weight: 700; }
    nav ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.15rem; }
    .nav-item { display: flex; align-items: center; gap: 0.55rem; width: 100%; padding: 0.45rem 0.55rem; background: transparent; border: 1px solid transparent; border-radius: var(--r-sm); font: inherit; font-size: 0.9em; color: var(--text); text-align: left; }
    .nav-item:hover { background: #f8fafc; }
    .nav-item.active { background: #eef2ff; color: #4338ca; font-weight: 600; }
    .nav-icon { width: 18px; text-align: center; font-size: 1em; }
    .sidebar-foot { padding: 0 0.4rem; }
    .status-pill { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.25rem 0.55rem; background: #ecfdf5; border-radius: 999px; font-size: 0.72em; color: #065f46; font-weight: 600; }
    .dot { width: 7px; height: 7px; border-radius: 50%; }
    .dot.ok { background: var(--success); }

    .main { display: grid; grid-template-rows: auto 1fr; min-width: 0; }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0.6rem 1.25rem; background: var(--surface); border-bottom: 1px solid var(--border); position: relative; z-index: 10; }
    .breadcrumb { font-size: 0.9em; }
    .breadcrumb .sep { margin: 0 0.4rem; color: var(--muted); }
    .breadcrumb .current { font-weight: 600; }
    .muted { color: var(--muted); }
    .topbar-actions { display: flex; align-items: center; gap: 0.6rem; }
    .search { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.35rem 0.7rem; background: var(--bg); border: 1px solid var(--border); border-radius: 999px; font-size: 0.85em; color: var(--muted); min-width: 220px; }
    .search input { border: 0; background: transparent; font: inherit; flex: 1 1 auto; outline: none; color: var(--text); }
    .search .kbd { font-family: ui-monospace, monospace; font-size: 0.75em; padding: 1px 5px; border-radius: 3px; background: var(--code-bg); color: var(--muted); }

    .icon-btn { position: relative; width: 34px; height: 34px; border: 1px solid var(--border); border-radius: 50%; background: var(--surface); display: inline-flex; align-items: center; justify-content: center; }
    .icon-btn:hover { background: #f8fafc; }
    .icon-btn .badge { position: absolute; top: -3px; right: -3px; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 999px; background: var(--error); color: #fff; font-size: 0.65em; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
    .avatar { width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; background: #e0e7ff; color: #3730a3; border-radius: 50%; font-size: 0.78em; font-weight: 700; }

    .page { max-width: 1100px; width: 100%; margin: 0 auto; padding: 1.6rem 1.5rem 3rem; display: grid; gap: 1.5rem; min-width: 0; }
    .hero h1 { margin: 0 0 0.2rem; font-size: 1.55rem; font-weight: 700; letter-spacing: -0.01em; }
    .hero .hero-tag { display: inline-block; font-size: 0.55em; padding: 3px 7px; border-radius: 999px; background: var(--code-bg); color: var(--muted); letter-spacing: 0.06em; vertical-align: 0.4em; margin-left: 0.4rem; }
    .hero p { margin: 0; color: var(--muted); }

    .block { display: grid; gap: 0.7rem; }
    .block h2 { margin: 0; font-size: 0.72em; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 600; }
    .cards { display: grid; gap: 0.9rem; }
    .cards[data-count='1'] { grid-template-columns: 1fr; }
    .cards[data-count='2'] { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
    .card, .page-card { min-width: 0; }

    /* ── Composer-page output mode ───────────────────────────────────── */
    .composer-output { display: grid; gap: 0.9rem; }
    .composer-output[data-mode='snapshot'] { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }

    .channel-banner { background: #ecfeff; border: 1px solid #a5f3fc; border-radius: var(--r-sm); padding: 0.5rem 0.75rem; display: flex; align-items: center; gap: 0.45rem; font-size: 0.85em; color: #155e75; }
    .channel-banner .dot { width: 8px; height: 8px; border-radius: 50%; background: #06b6d4; }
    .channel-banner code { background: #cffafe; padding: 1px 5px; border-radius: 3px; }
    .channel-banner .reason { color: #0e7490; font-style: italic; }

    .skeleton { display: grid; gap: 0.5rem; padding: 0.3rem 0; }
    .skeleton .line { height: 0.9rem; border-radius: var(--r-sm); background: linear-gradient(90deg, #e5e7eb 25%, #f1f5f9 50%, #e5e7eb 75%); background-size: 200% 100%; animation: shimmer 1.4s infinite; }
    .w-50 { width: 50%; } .w-70 { width: 70%; } .w-80 { width: 80%; } .w-90 { width: 90%; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    .placeholder.error { display: flex; gap: 0.6rem; align-items: center; padding: 0.6rem 0.8rem; background: #fef2f2; color: #991b1b; border-radius: var(--r-sm); font-size: 0.85em; }
    .placeholder.error .ico { width: 22px; height: 22px; border-radius: 50%; background: #fee2e2; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; }
    .placeholder.error p { margin: 0; }

    /* ── Shell-takeover mode (L5) ─────────────────────────────────────── */
    .shell-takeover { display: grid; grid-template-rows: auto 1fr; min-height: 100vh; background: var(--bg); }
    .takeover-bar {
      display: flex; align-items: center; gap: 0.6rem; padding: 0.5rem 1.25rem;
      background: linear-gradient(90deg, rgba(37, 99, 235, 0.06), rgba(6, 182, 212, 0.06));
      border-bottom: 1px solid #c7d2fe;
    }
    .takeover-bar .badge {
      padding: 0.25rem 0.6rem; border-radius: 999px;
      background: #4338ca; color: #fff;
      font-size: 0.72em; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
    }
    .takeover-bar .badge-meta { font-size: 0.8em; color: var(--muted); font-family: ui-monospace, monospace; }
    .takeover-bar .restore {
      margin-left: auto;
      padding: 0.35rem 0.8rem; background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-sm);
      font: inherit; font-size: 0.85em;
    }
    .takeover-bar .restore:hover { background: #f8fafc; }
    .takeover-body { padding: 1.5rem; max-width: 1100px; margin: 0 auto; width: 100%; }
    .takeover-loading { color: var(--muted); padding: 2rem; text-align: center; font-style: italic; }
    .takeover-error { background: #fef2f2; color: #991b1b; padding: 0.7rem 0.85rem; border-radius: var(--r-sm); }

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
  protected readonly composer = inject(ComposerService);

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
