-- Add vector columns to organizations table for semantic search
-- Using 1536 dimensions for OpenAI text-embedding-3-small or text-embedding-ada-002

-- Enable the pgvector extension if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Add vector columns to organizations table
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS name_embedding vector(1536);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS description_embedding vector(1536);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS category_embedding vector(1536);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS combined_embedding vector(1536);
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS vector_updated_at timestamp;

-- Add comments for clarity
COMMENT ON COLUMN organizations.name_embedding IS 'Vector embedding for organization name for semantic search';
COMMENT ON COLUMN organizations.description_embedding IS 'Vector embedding for organization description for semantic search';
COMMENT ON COLUMN organizations.category_embedding IS 'Vector embedding for organization category for semantic search';
COMMENT ON COLUMN organizations.combined_embedding IS 'Combined vector embedding for all organization text fields for semantic search';
COMMENT ON COLUMN organizations.vector_updated_at IS 'Timestamp when vector embeddings were last updated'; 