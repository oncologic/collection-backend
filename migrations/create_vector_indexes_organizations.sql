-- Create vector indexes for efficient similarity search on organizations table
-- Using HNSW (Hierarchical Navigable Small World) algorithm for fast approximate nearest neighbor search

-- Organizations table vector indexes
CREATE INDEX IF NOT EXISTS idx_organizations_name_embedding_hnsw 
ON organizations USING hnsw (name_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_organizations_description_embedding_hnsw 
ON organizations USING hnsw (description_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_organizations_category_embedding_hnsw 
ON organizations USING hnsw (category_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_organizations_combined_embedding_hnsw 
ON organizations USING hnsw (combined_embedding vector_cosine_ops);

-- Add index on vector_updated_at for efficient batch processing
CREATE INDEX IF NOT EXISTS idx_organizations_vector_updated_at ON organizations (vector_updated_at);

-- Add composite indexes for performance
CREATE INDEX IF NOT EXISTS idx_organizations_tenant_vector_updated 
ON organizations (tenant_id, vector_updated_at);

-- Comments for clarity
COMMENT ON INDEX idx_organizations_name_embedding_hnsw IS 'HNSW index for organization name embeddings cosine similarity search';
COMMENT ON INDEX idx_organizations_description_embedding_hnsw IS 'HNSW index for organization description embeddings cosine similarity search';
COMMENT ON INDEX idx_organizations_category_embedding_hnsw IS 'HNSW index for organization category embeddings cosine similarity search';
COMMENT ON INDEX idx_organizations_combined_embedding_hnsw IS 'HNSW index for organization combined embeddings cosine similarity search';
COMMENT ON INDEX idx_organizations_vector_updated_at IS 'Index for efficient organization vector batch processing';
COMMENT ON INDEX idx_organizations_tenant_vector_updated IS 'Composite index for tenant-specific vector batch processing'; 