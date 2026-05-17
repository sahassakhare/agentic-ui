import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { catalogBus, type CatalogEventBus } from '../events/catalog-bus.js';

const HEARTBEAT_INTERVAL_MS = 25_000;

/**
 * `GET /v1/catalogs/:tenant/stream` — Server-Sent Events stream of
 * catalog mutations scoped to the path tenant. Clients open a
 * long-lived `EventSource` connection and receive one
 * `event: mutation` frame per write the catalog observes.
 *
 * Per-tenant filtering happens here (not at the EventBus); RLS
 * already enforces tenant scope on the underlying data, the SSE
 * filter is a UX convenience to keep the client's event volume
 * low.
 *
 * Heartbeats every 25s as `event: ping` so intermediaries
 * (Render's load balancer, Cloudflare) don't time out the
 * connection. EventSource clients ignore unknown event names.
 *
 * The `bearerAuth` middleware in app.ts has already attached the
 * principal; we mount this route under the same auth chain so
 * AUTH_MODE=disabled deployments don't need a token. The
 * `requireTenantScope` middleware ensures cross-tenant SSE is
 * platform-admin-only.
 *
 * Multi-replica caveat: this endpoint subscribes to the
 * **in-process** EventBus, so events on a different replica are
 * not observed. Single-replica deployments (the Render demo) work
 * correctly; the Helm chart's `replicaCount: 2+` needs the
 * Postgres LISTEN/NOTIFY follow-up. See ADR-027 §D5.
 */
export function streamRoutes(bus: CatalogEventBus = catalogBus): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const principal = c.get('principal');
    const tenantId = principal.tenantId;

    return streamSSE(c, async (stream) => {
      // 1. Open frame — clients can use this to confirm the stream
      //    is live (and the catalog noticed them).
      await stream.writeSSE({
        event: 'open',
        data: JSON.stringify({ tenantId, at: new Date().toISOString() }),
      });

      // 2. Subscribe to bus + forward filtered events.
      const unsubscribe = bus.subscribe((event) => {
        if (event.tenantId !== tenantId) return;
        // Fire-and-forget — write errors close the stream;
        // hono's streamSSE handles the cleanup.
        void stream.writeSSE({
          event: 'mutation',
          data: JSON.stringify(event),
        });
      });

      // 3. Heartbeat — keeps intermediaries from killing idle
      //    connections. Browsers ignore the `ping` event name
      //    unless the client explicitly listens for it.
      const heartbeat = setInterval(() => {
        void stream.writeSSE({
          event: 'ping',
          data: JSON.stringify({ at: new Date().toISOString() }),
        });
      }, HEARTBEAT_INTERVAL_MS);

      // 4. Cleanup when the client disconnects.
      stream.onAbort(() => {
        clearInterval(heartbeat);
        unsubscribe();
      });

      // 5. Keep the handler alive while the connection is open.
      //    `streamSSE` resolves when `stream.close()` is called or
      //    the request aborts.
      await new Promise<void>((resolve) => stream.onAbort(resolve));
    });
  });

  return app;
}
