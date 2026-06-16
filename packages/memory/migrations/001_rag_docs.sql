CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS rag_docs (
  id            text PRIMARY KEY,
  text          text NOT NULL,
  embedding     vector NOT NULL,
  model_version text NOT NULL,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ts            bigint NOT NULL
);

-- NOTE: no ivfflat/hnsw ANN index here. pgvector requires a fixed-dimension
-- column (vector(N)) to build one, but `embedding` is intentionally dimensionless
-- so the store dimension is configurable per instance (PgvectorRagStore.dimension).
-- Cosine search via `embedding <=> $1` works exactly without an index (sequential
-- scan). Re-add an ivfflat index here once a production embedding dimension is
-- locked and the column is pinned to vector(N).

CREATE INDEX IF NOT EXISTS rag_docs_metadata_idx ON rag_docs USING GIN (metadata);
