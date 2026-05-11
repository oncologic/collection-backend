-- Add timestamps_embedding column to resources table
-- This enables semantic search on timestamp data

ALTER TABLE resources ADD COLUMN IF NOT EXISTS timestamps_embedding vector(1536);

-- Create index for efficient similarity search on timestamps
CREATE INDEX IF NOT EXISTS idx_resources_timestamps_embedding_hnsw 
ON resources USING hnsw (timestamps_embedding vector_cosine_ops); 