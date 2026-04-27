import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { PointsCardComponent } from './widgets/points-card.component';
import { checkPointsTool } from './tools/check-points.tool';
import { redeemPointsTool } from './tools/redeem-points.tool';

/**
 * Standalone domain UI for the loyalty remote. Uses the SAME tool handlers
 * (`checkPointsTool.handler`, `redeemPointsTool.handler`) and the SAME widget
 * (`PointsCardComponent`) that the host shell consumes via federation — so
 * visiting :4203 directly proves the capability is a complete domain artefact,
 * not just a chat shim.
 */
@Component({
  selector: 'app-root',
  imports: [FormsModule, RouterOutlet, PointsCardComponent],
  template: `
    <main>
      <header>
        <h1>demo-remote-loyalty</h1>
        <p class="subtle">
          Domain MFE for the loyalty programme. Contributes <code>checkPointsTool</code>,
          <code>redeemPointsTool</code>, and the <code>pointsCard</code> widget to the host
          shell at <a href="http://localhost:4200">localhost:4200</a> via Native Federation.
          Both forms below use the <strong>exact same handlers and widget</strong>
          the agent uses — proving the domain artefact serves UI and agent paths alike.
        </p>
      </header>

      <section class="panel">
        <h2>Points balance</h2>
        <button type="button" (click)="checkPoints()" [disabled]="loadingCheck()">
          {{ loadingCheck() ? 'Checking…' : 'Check my points' }}
        </button>

        @if (balance(); as b) {
          <div class="result">
            <p class="caption">Result — rendered by <code>PointsCardComponent</code> (same widget the agent uses):</p>
            <app-points-card
              [balance]="b.balance"
              [tier]="b.tier"
              [nextTier]="b.nextTier"
              [nextTierAt]="b.nextTierAt"
            />
          </div>
        }
      </section>

      <section class="panel">
        <h2>Redeem points</h2>
        <form (ngSubmit)="redeem()" class="form">
          <label>
            <span>Points</span>
            <input name="points" type="number" min="1" [(ngModel)]="points" required>
          </label>
          <label>
            <span>Reward</span>
            <select name="reward" [(ngModel)]="reward" required>
              <option value="flight">Flight</option>
              <option value="upgrade">Upgrade</option>
              <option value="gift-card">Gift card</option>
            </select>
          </label>
          <button type="submit" [disabled]="loadingRedeem()">
            {{ loadingRedeem() ? 'Redeeming…' : 'Redeem' }}
          </button>
        </form>

        @if (redemption(); as r) {
          <p class="confirm">
            ✓ Redeemed <strong>{{ r.points }}</strong> points for a
            <strong>{{ r.reward }}</strong>. Confirmation: <code>{{ r.redemptionId }}</code>
          </p>
        }
      </section>

      @if (error(); as e) {
        <p class="error">⚠️ {{ e }}</p>
      }

      <router-outlet />
    </main>
  `,
  styles: `
    :host { display: block; font-family: system-ui, sans-serif; padding: 2rem 1.5rem; max-width: 720px; margin: 0 auto; color: #0f172a; }
    header { margin-bottom: 1.5rem; }
    h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
    h2 { font-size: 1.05rem; margin: 0 0 0.8rem; color: #1e293b; }
    .subtle { color: #475569; font-size: 0.9rem; line-height: 1.5; margin: 0; }
    .panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 0.5rem; padding: 1.25rem; margin-bottom: 1rem; }
    .form { display: grid; grid-template-columns: 1fr 1.4fr auto; gap: 0.6rem; align-items: end; }
    label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.78rem; color: #475569; }
    label span { font-weight: 500; }
    input, select { padding: 0.45rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 4px; font: inherit; background: white; }
    input:focus, select:focus { outline: 2px solid #d97706; outline-offset: -1px; border-color: transparent; }
    button { padding: 0.5rem 1rem; background: #d97706; color: white; border: none; border-radius: 4px; font: inherit; font-weight: 500; cursor: pointer; }
    button:hover:not(:disabled) { background: #b45309; }
    button:disabled { background: #94a3b8; cursor: not-allowed; }
    .error { color: #b91c1c; font-size: 0.85rem; margin: 0.5rem 0 0; }
    .confirm { color: #065f46; background: #d1fae5; padding: 0.6rem 0.8rem; border-radius: 4px; font-size: 0.9rem; margin: 0.8rem 0 0; }
    .result { margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed #e2e8f0; }
    .caption { color: #64748b; font-size: 0.8rem; margin: 0 0 0.4rem; }
    a { color: #2563eb; }
    code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; font-size: 0.85em; }
  `,
})
export class App {
  protected points = 25_000;
  protected reward: 'flight' | 'upgrade' | 'gift-card' = 'flight';

  protected readonly loadingCheck = signal(false);
  protected readonly loadingRedeem = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly balance = signal<{
    balance: number;
    tier: string;
    nextTier: string;
    nextTierAt: number | null;
  } | null>(null);

  protected readonly redemption = signal<{
    redemptionId: string;
    points: number;
    reward: string;
    status: string;
  } | null>(null);

  async checkPoints(): Promise<void> {
    this.error.set(null);
    this.loadingCheck.set(true);
    try {
      const result = await checkPointsTool.handler({}, standaloneToolContext());
      const { components: _c, ...rest } = result as Record<string, unknown> & {
        balance: number; tier: string; nextTier: string; nextTierAt: number | null;
      };
      this.balance.set(rest);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loadingCheck.set(false);
    }
  }

  async redeem(): Promise<void> {
    this.error.set(null);
    this.loadingRedeem.set(true);
    try {
      const result = await redeemPointsTool.handler(
        { points: Number(this.points), reward: this.reward },
        standaloneToolContext(),
      );
      this.redemption.set(result as {
        redemptionId: string; points: number; reward: string; status: string;
      });
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loadingRedeem.set(false);
    }
  }
}

function standaloneToolContext() {
  const id = `standalone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    threadId: 'standalone',
    runId: id,
    toolCallId: id,
    signal: new AbortController().signal,
  };
}
