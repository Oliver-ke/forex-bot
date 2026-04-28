CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS rag_docs (
  id            text PRIMARY KEY,
  text          text NOT NULL,
  embedding     vector NOT NULL,
  model_version text NOT NULL,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  ts            bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS rag_docs_embedding_idx
  ON rag_docs
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);

CREATE INDEX IF NOT EXISTS rag_docs_metadata_idx ON rag_docs USING GIN (metadata);
