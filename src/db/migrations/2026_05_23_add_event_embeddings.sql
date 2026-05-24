ALTER TABLE events
  ADD COLUMN IF NOT EXISTS title_embedding vector(1536),
  ADD COLUMN IF NOT EXISTS description_embedding vector(1536),
  ADD COLUMN IF NOT EXISTS location_embedding vector(1536),
  ADD COLUMN IF NOT EXISTS combined_embedding vector(1536),
  ADD COLUMN IF NOT EXISTS vector_updated_at timestamp;

CREATE INDEX IF NOT EXISTS idx_events_combined_embedding_hnsw
  ON events USING hnsw (combined_embedding vector_cosine_ops);

COMMENT ON COLUMN events.title_embedding IS 'Vector embedding for event title semantic search';
COMMENT ON COLUMN events.description_embedding IS 'Vector embedding for event description semantic search';
COMMENT ON COLUMN events.location_embedding IS 'Vector embedding for event location fields semantic search';
COMMENT ON COLUMN events.combined_embedding IS 'Combined vector embedding for event text fields semantic search';
COMMENT ON COLUMN events.vector_updated_at IS 'Timestamp when event vector embeddings were last generated';
