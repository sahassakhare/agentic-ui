import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { FlightCardComponent } from './widgets/flight-card.component';
import { bookFlightTool } from './tools/book-flight.tool';

/**
 * Standalone domain UI for the bookings remote. Uses the SAME tool handler
 * (`bookFlightTool.handler`) and the SAME widget (`FlightCardComponent`) that
 * the host shell consumes via federation — so visiting :4201 directly proves
 * the capability is a complete domain artefact, not just a chat shim.
 */
@Component({
  selector: 'app-root',
  imports: [FormsModule, RouterOutlet, FlightCardComponent],
  template: `
    <main>
      <header>
        <h1>demo-remote-bookings</h1>
        <p class="subtle">
          Domain MFE for flight booking. Contributes <code>bookFlightTool</code>
          and the <code>flightCard</code> widget to the host shell at
          <a href="http://localhost:4200">localhost:4200</a> via Native Federation.
          The form below uses the <strong>exact same handler and component</strong>
          — proof that one domain artefact serves both UI and agent paths.
        </p>
      </header>

      <section class="panel">
        <h2>Book a flight</h2>
        <form (ngSubmit)="book()" class="form">
          <label>
            <span>From</span>
            <input name="from" [(ngModel)]="from" placeholder="LAX" maxlength="6" required>
          </label>
          <label>
            <span>To</span>
            <input name="to" [(ngModel)]="to" placeholder="JFK" maxlength="6" required>
          </label>
          <label>
            <span>Date</span>
            <input name="date" type="date" [(ngModel)]="date" required>
          </label>
          <button type="submit" [disabled]="loading()">
            {{ loading() ? 'Booking…' : 'Book' }}
          </button>
        </form>

        @if (error(); as e) {
          <p class="error">⚠️ {{ e }}</p>
        }

        @if (booking(); as b) {
          <div class="result">
            <p class="caption">Result — rendered by <code>FlightCardComponent</code> (same widget the agent uses):</p>
            <app-flight-card
              [bookingId]="b.bookingId"
              [from]="b.from"
              [to]="b.to"
              [date]="b.date"
              [status]="b.status"
            />
          </div>
        }
      </section>

      <router-outlet />
    </main>
  `,
  styles: `
    :host { display: block; font-family: system-ui, sans-serif; padding: 2rem 1.5rem; max-width: 720px; margin: 0 auto; color: #0f172a; }
    header { margin-bottom: 1.5rem; }
    h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
    h2 { font-size: 1.05rem; margin: 0 0 0.8rem; color: #1e293b; }
    .subtle { color: #475569; font-size: 0.9rem; line-height: 1.5; margin: 0; }
    .panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 0.5rem; padding: 1.25rem; }
    .form { display: grid; grid-template-columns: 1fr 1fr 1.1fr auto; gap: 0.6rem; align-items: end; }
    label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.78rem; color: #475569; }
    label span { font-weight: 500; }
    input { padding: 0.45rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 4px; font: inherit; }
    input:focus { outline: 2px solid #2563eb; outline-offset: -1px; border-color: transparent; }
    button { padding: 0.5rem 1rem; background: #2563eb; color: white; border: none; border-radius: 4px; font: inherit; font-weight: 500; cursor: pointer; }
    button:hover:not(:disabled) { background: #1d4ed8; }
    button:disabled { background: #94a3b8; cursor: not-allowed; }
    .error { color: #b91c1c; font-size: 0.85rem; margin: 0.8rem 0 0; }
    .result { margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed #e2e8f0; }
    .caption { color: #64748b; font-size: 0.8rem; margin: 0 0 0.4rem; }
    a { color: #2563eb; }
    code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; font-size: 0.85em; }
  `,
})
export class App {
  protected from = 'LAX';
  protected to = 'JFK';
  protected date = '2026-05-05';

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly booking = signal<{
    bookingId: string;
    from: string;
    to: string;
    date: string;
    status: string;
  } | null>(null);

  async book(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      const result = await bookFlightTool.handler(
        { from: this.from.toUpperCase(), to: this.to.toUpperCase(), date: this.date },
        standaloneToolContext(),
      );
      // Strip the generative-UI hint; the standalone path renders its own widget.
      const { components: _components, ...booking } = result as Record<string, unknown> & {
        bookingId: string; from: string; to: string; date: string; status: string;
      };
      this.booking.set(booking);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loading.set(false);
    }
  }
}

/**
 * Synthesise a minimal `ToolContext` for direct standalone-UI calls. The
 * agentic tool handlers expect a context but the demo handlers don't read
 * from it, so a stable synthetic id + a never-aborting signal is fine. In a
 * real app you'd thread real ids through.
 */
function standaloneToolContext() {
  const id = `standalone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    threadId: 'standalone',
    runId: id,
    toolCallId: id,
    signal: new AbortController().signal,
    // Capability F5 LRO surface — standalone path is synchronous.
    startOperation: () => `op-bookings-${Date.now()}`,
    reportProgress: () => undefined,
    completeOperation: () => undefined,
    failOperation: () => undefined,
  };
}
