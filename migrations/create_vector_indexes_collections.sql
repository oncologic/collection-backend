-- Create vector indexes for efficient similarity search on collections-related tables
-- Using HNSW (Hierarchical Navigable Small World) algorithm for fast approximate nearest neighbor search

-- Collections table vector indexes
CREATE INDEX IF NOT EXISTS idx_collections_name_embedding_hnsw 
ON collections USING hnsw (name_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_collections_description_embedding_hnsw 
ON collections USING hnsw (description_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_collections_hashtags_embedding_hnsw 
ON collections USING hnsw (hashtags_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_collections_combined_embedding_hnsw 
ON collections USING hnsw (combined_embedding vector_cosine_ops);

-- External links table vector indexes
CREATE INDEX IF NOT EXISTS idx_external_links_name_embedding_hnsw 
ON external_links USING hnsw (name_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_external_links_description_embedding_hnsw 
ON external_links USING hnsw (description_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_external_links_notes_embedding_hnsw 
ON external_links USING hnsw (notes_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_external_links_full_text_embedding_hnsw 
ON external_links USING hnsw (full_text_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_external_links_timestamps_embedding_hnsw 
ON external_links USING hnsw (timestamps_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_external_links_combined_embedding_hnsw 
ON external_links USING hnsw (combined_embedding vector_cosine_ops);

-- Collection external links notations table vector indexes
CREATE INDEX IF NOT EXISTS idx_cel_notations_title_embedding_hnsw 
ON collection_external_links_notations USING hnsw (title_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_cel_notations_description_embedding_hnsw 
ON collection_external_links_notations USING hnsw (description_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_cel_notations_notes_embedding_hnsw 
ON collection_external_links_notations USING hnsw (notes_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_cel_notations_category_embedding_hnsw 
ON collection_external_links_notations USING hnsw (category_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_cel_notations_combined_embedding_hnsw 
ON collection_external_links_notations USING hnsw (combined_embedding vector_cosine_ops);

-- Link groups table vector indexes
CREATE INDEX IF NOT EXISTS idx_link_groups_name_embedding_hnsw 
ON link_groups USING hnsw (name_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_link_groups_description_embedding_hnsw 
ON link_groups USING hnsw (description_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_link_groups_category_embedding_hnsw 
ON link_groups USING hnsw (category_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_link_groups_combined_embedding_hnsw 
ON link_groups USING hnsw (combined_embedding vector_cosine_ops);

-- Attachments table vector indexes
CREATE INDEX IF NOT EXISTS idx_attachments_title_embedding_hnsw 
ON attachments USING hnsw (title_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_attachments_description_embedding_hnsw 
ON attachments USING hnsw (description_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_attachments_combined_embedding_hnsw 
ON attachments USING hnsw (combined_embedding vector_cosine_ops);

-- Add indexes on vector_updated_at for efficient batch processing
CREATE INDEX IF NOT EXISTS idx_collections_vector_updated_at ON collections (vector_updated_at);
CREATE INDEX IF NOT EXISTS idx_external_links_vector_updated_at ON external_links (vector_updated_at);
CREATE INDEX IF NOT EXISTS idx_cel_notations_vector_updated_at ON collection_external_links_notations (vector_updated_at);
CREATE INDEX IF NOT EXISTS idx_link_groups_vector_updated_at ON link_groups (vector_updated_at);
CREATE INDEX IF NOT EXISTS idx_attachments_vector_updated_at ON attachments (vector_updated_at); 