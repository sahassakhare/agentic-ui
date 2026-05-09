import { serve, type ServerType } from '@hono/node-server';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';
import { buildApp } from './app.js';
import { logger } from './logger.js';

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

  const app = buildApp({
    pool,
    auth: {
      issuer: config.OIDC_ISSUER,
      audience: config.OIDC_AUDIENCE,
      jwksUri: config.OIDC_JWKS_URI,
      tenantClaim: config.OIDC_TENANT_CLAIM,
      rolesClaim: config.OIDC_ROLES_CLAIM,
    },
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
