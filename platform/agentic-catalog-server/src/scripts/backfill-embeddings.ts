/**
 * Backfill embeddings for existing capabilities (slice SEM-A / ADR-038).
 *
 * Idempotent: skips rows whose `embedding` column is non-NULL. Run
 * this once after configuring EMBEDDING_PROVIDER=openai|cohere|ollama;
 * future fresh inserts populate the column on POST.
 *
 * Usage:
 *   npm run backfill:embeddings
 *
 * Environment:
 *   DATABASE_URL — required
 *   EMBEDDING_PROVIDER, EMBEDDING_API_KEY, EMBEDDING_MODEL,
 *   EMBEDDING_API_URL, EMBEDDING_DIM — same as the server
 *
 * Exits with status 0 on success, 1 on partial failure (some rows
 * couldn't be embedded; rerun later).
 */

import pg from 'pg';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import {
  buildEmbeddingText,
  makeEmbeddingProvider,
} from '../embeddings/provider.js';
import { updateCapabilityEmbedding } from '../repository/capability-repo.js';

interface CapabilityForBackfill {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly tags: readonly string[];
  readonly body: Record<string, unknown>;
}

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.EMBEDDING_PROVIDER === 'noop') {
    logger.info('EMBEDDING_PROVIDER=noop — nothing to backfill. Set EMBEDDING_PROVIDER first.');
    process.exit(0);
  }

  const provider = makeEmbeddingProvider({
    provider: config.EMBEDDING_PROVIDER,
    ...(config.EMBEDDING_API_KEY ? { apiKey: config.EMBEDDING_API_KEY } : {}),
    ...(config.EMBEDDING_API_URL ? { apiUrl: config.EMBEDDING_API_URL } : {}),
    ...(config.EMBEDDING_MODEL ? { model: config.EMBEDDING_MODEL } : {}),
    dim: config.EMBEDDING_DIM,
  });
  logger.info({ provider: provider.name, dim: provider.dim }, 'embedding provider configured');

  const pool = new pg.Pool({ connectionString: config.DATABASE_URL });
  const client = await pool.connect();
  try {
    // platform-admin scope (no RLS — we want every tenant's rows).
    await client.query(`SET LOCAL app.tenant_id = ''`);

    const { rows } = await client.query<CapabilityForBackfill>(
      `SELECT id, kind, name, tags, body
         FROM capabilities
        WHERE embedding IS NULL
          AND soft_deleted_at IS NULL
        ORDER BY created_at ASC`,
    );

    if (rows.length === 0) {
      logger.info('No capabilities need embedding — exiting.');
      return;
    }
    logger.info({ count: rows.length }, 'rows pending embedding');

    let success = 0;
    let failed = 0;
    for (const row of rows) {
      const text = buildEmbeddingText({
        kind: row.kind,
        name: row.name,
        tags: row.tags,
        body: row.body,
      });
      const vec = await provider.embed(text);
      if (vec) {
        await updateCapabilityEmbedding(client, row.id, vec);
        success++;
      } else {
        // null vec = provider transient failure; skip + retry next run.
        failed++;
        logger.warn({ id: row.id, name: row.name }, 'embedding returned null — skipped');
      }
      if ((success + failed) % 25 === 0) {
        logger.info({ done: success + failed, total: rows.length, success, failed }, 'progress');
      }
    }
    logger.info({ success, failed, total: rows.length }, 'backfill complete');
    if (failed > 0) process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, 'backfill failed');
  process.exit(1);
});
