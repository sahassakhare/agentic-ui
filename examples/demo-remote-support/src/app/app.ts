import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { TicketCardComponent } from './widgets/ticket-card.component';
import { openTicketTool } from './tools/open-ticket.tool';
import { checkTicketTool } from './tools/check-ticket.tool';

/**
 * Standalone domain UI for the support remote. Uses the SAME tool handlers
 * (`openTicketTool.handler`, `checkTicketTool.handler`) and the SAME widget
 * (`TicketCardComponent`) that the host shell consumes via federation — so
 * visiting :4205 directly proves the capability is a complete domain artefact,
 * not just a chat shim.
 */
@Component({
  selector: 'app-root',
  imports: [FormsModule, RouterOutlet, TicketCardComponent],
  template: `
    <main>
      <header>
        <h1>demo-remote-support</h1>
        <p class="subtle">
          Domain MFE for customer support. Contributes <code>openTicketTool</code>,
          <code>checkTicketTool</code>, and the <code>ticketCard</code> widget to the host
          shell at <a href="http://localhost:4200">localhost:4200</a> via Native Federation.
          Both forms below use the <strong>exact same handlers and widget</strong>
          the agent uses — proving the domain artefact serves UI and agent paths alike.
        </p>
      </header>

      <section class="panel">
        <h2>Open a ticket</h2>
        <form (ngSubmit)="open()" class="form">
          <label class="span2">
            <span>Subject</span>
            <input name="subject" [(ngModel)]="subject" placeholder="My refund hasn't arrived" required>
          </label>
          <label>
            <span>Priority</span>
            <select name="priority" [(ngModel)]="priority" required>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </label>
          <button type="submit" [disabled]="loadingOpen()">
            {{ loadingOpen() ? 'Opening…' : 'Open ticket' }}
          </button>
        </form>

        @if (opened(); as t) {
          <div class="result">
            <p class="caption">Result — rendered by <code>TicketCardComponent</code> (same widget the agent uses):</p>
            <app-ticket-card
              [ticketId]="t.ticketId"
              [subject]="t.subject"
              [status]="t.status"
              [priority]="t.priority"
            />
          </div>
        }
      </section>

      <section class="panel">
        <h2>Check ticket status</h2>
        <form (ngSubmit)="check()" class="form-inline">
          <label>
            <span>Ticket ID</span>
            <input name="ticketId" [(ngModel)]="ticketId" placeholder="TICK-AB12CD" required>
          </label>
          <button type="submit" [disabled]="loadingCheck()">
            {{ loadingCheck() ? 'Checking…' : 'Check status' }}
          </button>
        </form>

        @if (checked(); as t) {
          <div class="result">
            <p class="caption">Result — rendered by <code>TicketCardComponent</code>:</p>
            <app-ticket-card
              [ticketId]="t.ticketId"
              [subject]="t.subject"
              [status]="t.status"
              [priority]="t.priority"
            />
          </div>
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
    .form { display: grid; grid-template-columns: 1fr 1fr auto; gap: 0.6rem; align-items: end; }
    .form .span2 { grid-column: span 2; }
    .form-inline { display: grid; grid-template-columns: 1fr auto; gap: 0.6rem; align-items: end; }
    label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.78rem; color: #475569; }
    label span { font-weight: 500; }
    input, select { padding: 0.45rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 4px; font: inherit; background: white; }
    input:focus, select:focus { outline: 2px solid #7c3aed; outline-offset: -1px; border-color: transparent; }
    button { padding: 0.5rem 1rem; background: #7c3aed; color: white; border: none; border-radius: 4px; font: inherit; font-weight: 500; cursor: pointer; }
    button:hover:not(:disabled) { background: #6d28d9; }
    button:disabled { background: #94a3b8; cursor: not-allowed; }
    .error { color: #b91c1c; font-size: 0.85rem; margin: 0.5rem 0 0; }
    .result { margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed #e2e8f0; }
    .caption { color: #64748b; font-size: 0.8rem; margin: 0 0 0.4rem; }
    a { color: #2563eb; }
    code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; font-size: 0.85em; }
  `,
})
export class App {
  protected subject = "My refund hasn't arrived";
  protected priority: 'low' | 'normal' | 'high' = 'normal';
  protected ticketId = '';

  protected readonly loadingOpen = signal(false);
  protected readonly loadingCheck = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly opened = signal<{
    ticketId: string; subject: string; status: string; priority: string;
  } | null>(null);

  protected readonly checked = signal<{
    ticketId: string; subject: string; status: string; priority: string;
  } | null>(null);

  async open(): Promise<void> {
    this.error.set(null);
    this.loadingOpen.set(true);
    try {
      const result = await openTicketTool.handler(
        { subject: this.subject, priority: this.priority },
        standaloneToolContext(),
      );
      const { components: _c, ...rest } = result as Record<string, unknown> & {
        ticketId: string; subject: string; status: string; priority: string;
      };
      this.opened.set(rest);
      // Pre-fill the check form with the just-opened ticket so the user can
      // click "Check status" without re-typing the id.
      this.ticketId = rest.ticketId;
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loadingOpen.set(false);
    }
  }

  async check(): Promise<void> {
    this.error.set(null);
    this.loadingCheck.set(true);
    try {
      const result = await checkTicketTool.handler(
        { ticketId: this.ticketId },
        standaloneToolContext(),
      );
      const { components: _c, ...rest } = result as Record<string, unknown> & {
        ticketId: string; subject: string; status: string; priority: string;
      };
      this.checked.set(rest);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loadingCheck.set(false);
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
    // Capability F5 LRO surface — standalone path is synchronous.
    startOperation: () => `op-support-${Date.now()}`,
    reportProgress: () => undefined,
    completeOperation: () => undefined,
    failOperation: () => undefined,
  };
}
