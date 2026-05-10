-- Up Migration
-- Slice SEM-A — semantic capability search via pgvector. ADR-038.
--
-- pgvector ships with the `pgvector/pgvector` Docker image. Render's
-- starter-plan managed Postgres does NOT ship it pre-enabled —
-- adopters who want semantic search either upgrade to a tier that
-- includes pgvector OR run `CREATE EXTENSION vector;` manually as a
-- privileged user.
--
-- This migration is **defensive**: it checks for pgvector availability
-- and only adds the embedding column + HNSW index when present. On
-- Postgres clusters without pgvector, the migration is a no-op and
-- emits a NOTICE — the catalog server starts successfully and
-- semantic-search endpoints return 422 "not configured" until
-- pgvector is enabled. Existing pgvector-equipped clusters get the
-- column on first run; re-runs are idempotent.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    CREATE EXTENSION IF NOT EXISTS vector;

    -- Embedding column. Dimension defaults to 1536 (OpenAI
    -- text-embedding-3-small) — adopters using a different
    -- provider/dim run a separate ALTER before flipping the env var.
    EXECUTE 'ALTER TABLE capabilities ADD COLUMN IF NOT EXISTS embedding vector(1536)';

    -- HNSW index for cosine-distance queries. M=16 + ef_construction=64
    -- are pgvector's recommended defaults for read-mostly workloads.
    EXECUTE 'CREATE INDEX IF NOT EXISTS capabilities_embedding_idx
             ON capabilities USING hnsw (embedding vector_cosine_ops)
             WITH (m = 16, ef_construction = 64)';
    RAISE NOTICE 'pgvector enabled; embedding column + HNSW index created';
  ELSE
    RAISE NOTICE 'pgvector extension NOT available on this cluster -- semantic search will return 422 until enabled. Install pgvector + re-run migrations to populate the embedding column.';
  END IF;
END $$;
