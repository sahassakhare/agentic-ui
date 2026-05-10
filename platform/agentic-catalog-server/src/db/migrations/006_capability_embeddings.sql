-- Up Migration
-- Slice SEM-A — semantic capability search via pgvector. ADR-038.

-- pgvector ships with the `pgvector/pgvector` Docker image and is
-- available on Render's managed Postgres. Skip-creating the extension
-- if it's already present so this migration is idempotent on
-- re-runs.
CREATE EXTENSION IF NOT EXISTS vector;

-- Embedding column. NULL until backfilled or until a fresh insert
-- generates one. Dimension defaults to 1536 (OpenAI
-- text-embedding-3-small) — adopters using a different provider/dim
-- should run a separate ALTER before flipping the env var.
ALTER TABLE capabilities ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- HNSW index for cosine-distance queries. M=16 + ef_construction=64
-- are pgvector's recommended defaults for read-mostly workloads.
-- Postgres-side `WHERE embedding IS NOT NULL` queries can use the
-- index when an HNSW filter clause is present.
CREATE INDEX IF NOT EXISTS capabilities_embedding_idx
  ON capabilities USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
