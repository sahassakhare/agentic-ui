import { serve, type ServerType } from '@hono/node-server';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { buildApp } from './app.js';
import { logger } from './logger.js';
import { catalogBus } from './events/catalog-bus.js';
import { setCatalogEventPublisher } from './events/publisher.js';
import { PgNotifyListener } from './events/pg-notify-listener.js';
import { REPLICA_ID } from './events/replica-id.js';

/**
 * Process entry point. Loads config, opens the pool, builds the
 * Hono app, listens on PORT. Wires graceful shutdown on SIGTERM /
 * SIGINT.
 */
async function main(): Promise<void> {
  const config = loadConfig();

  const pool = createPool({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    idleTimeoutMillis: config.DATABASE_IDLE_MS,
    statementTimeoutMs: config.DATABASE_STATEMENT_TIMEOUT_MS,
  });

  // ── Multi-replica SSE plumbing (ADR-029) ─────────────────────
  // Open a dedicated LISTEN connection on the same DATABASE_URL.
  // Mutation routes call publishCatalogEvent(...) which we wire
  // here to do BOTH local bus emit (for this replica's SSE clients)
  // AND pg_notify (so other replicas see the event). The listener's
  // notification handler filters self-echo via REPLICA_ID.
  const pgNotify = new PgNotifyListener({ pool, bus: catalogBus, replicaId: REPLICA_ID });
  await pgNotify.start();
  setCatalogEventPublisher({
    publish: (event) => {
      // Fire-and-forget — pg_notify is best-effort cross-replica.
      // Local bus emit happens inside publishLocalAndRemote synchronously
      // BEFORE the awaited query, so local SSE clients see the event
      // immediately even if pg_notify is slow.
      void pgNotify.publishLocalAndRemote(event);
    },
  });

  const app = buildApp({
    pool,
    authMode: config.AUTH_MODE,
    auth: config.AUTH_MODE === 'oidc'
      ? {
          // loadConfig() guarantees these are set when AUTH_MODE=oidc.
          issuer: config.OIDC_ISSUER!,
          audience: config.OIDC_AUDIENCE!,
          jwksUri: config.OIDC_JWKS_URI,
          tenantClaim: config.OIDC_TENANT_CLAIM,
          rolesClaim: config.OIDC_ROLES_CLAIM,
        }
      : undefined,
  });

  const server = serve({
    fetch: app.fetch,
    port: config.PORT,
    hostname: config.HOST,
  }, (info) => {
    logger.info({
      port: info.port,
      host: config.HOST,
    }, 'agentic-catalog-server listening');
  });

  // Graceful shutdown — drain in-flight, close pool, exit clean.
  setupGracefulShutdown(server, async () => {
    logger.info('closing pg LISTEN connection');
    await pgNotify.stop();
    logger.info('closing DB pool');
    await pool.end();
  }, config.SHUTDOWN_GRACE_MS);
}

function setupGracefulShutdown(
  server: ServerType,
  cleanup: () => Promise<void>,
  graceMs: number,
): void {
  let shuttingDown = false;
  const handler = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutdown signal received');

    const drainTimer = setTimeout(() => {
      logger.warn({ graceMs }, 'shutdown grace expired; forcing exit');
      process.exit(1);
    }, graceMs);
    drainTimer.unref();

    server.close(async (err) => {
      if (err) {
        logger.error({ err }, 'error while closing server');
      }
      try {
        await cleanup();
      } catch (cleanupErr) {
        logger.error({ err: cleanupErr }, 'cleanup failed during shutdown');
      }
      logger.info('shutdown complete');
      process.exit(err ? 1 : 0);
    });
  };
  process.on('SIGTERM', () => void handler('SIGTERM'));
  process.on('SIGINT', () => void handler('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'fatal startup error');
  process.exit(1);
});
