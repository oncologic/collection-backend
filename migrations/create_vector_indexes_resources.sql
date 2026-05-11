-- Create vector indexes for efficient similarity search on resources table
-- Using HNSW (Hierarchical Navigable Small World) algorithm for fast approximate nearest neighbor search

-- Resources table vector indexes
CREATE INDEX IF NOT EXISTS idx_resources_name_embedding_hnsw 
ON resources USING hnsw (name_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_resources_description_embedding_hnsw 
ON resources USING hnsw (description_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_resources_full_text_embedding_hnsw 
ON resources USING hnsw (full_text_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_resources_combined_embedding_hnsw 
ON resources USING hnsw (combined_embedding vector_cosine_ops);

-- Add index on vector_updated_at for efficient batch processing
CREATE INDEX IF NOT EXISTS idx_resources_vector_updated_at ON resources (vector_updated_at); 