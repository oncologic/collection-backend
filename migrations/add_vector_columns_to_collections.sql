-- Add vector columns to collections-related tables for semantic search
-- Using 1536 dimensions for OpenAI text-embedding-3-small or text-embedding-ada-002

-- Enable the pgvector extension if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Add vector columns to collections table
ALTER TABLE collections ADD COLUMN IF NOT EXISTS name_embedding vector(1536);
ALTER TABLE collections ADD COLUMN IF NOT EXISTS description_embedding vector(1536);
ALTER TABLE collections ADD COLUMN IF NOT EXISTS hashtags_embedding vector(1536);
ALTER TABLE collections ADD COLUMN IF NOT EXISTS combined_embedding vector(1536);
ALTER TABLE collections ADD COLUMN IF NOT EXISTS vector_updated_at timestamp;

-- Add vector columns to external_links table
ALTER TABLE external_links ADD COLUMN IF NOT EXISTS name_embedding vector(1536);
ALTER TABLE external_links ADD COLUMN IF NOT EXISTS description_embedding vector(1536);
ALTER TABLE external_links ADD COLUMN IF NOT EXISTS notes_embedding vector(1536);
ALTER TABLE external_links ADD COLUMN IF NOT EXISTS full_text_embedding vector(1536);
ALTER TABLE external_links ADD COLUMN IF NOT EXISTS timestamps_embedding vector(1536);
ALTER TABLE external_links ADD COLUMN IF NOT EXISTS combined_embedding vector(1536);
ALTER TABLE external_links ADD COLUMN IF NOT EXISTS vector_updated_at timestamp;

-- Add vector columns to collection_external_links_notations table
ALTER TABLE collection_external_links_notations ADD COLUMN IF NOT EXISTS title_embedding vector(1536);
ALTER TABLE collection_external_links_notations ADD COLUMN IF NOT EXISTS description_embedding vector(1536);
ALTER TABLE collection_external_links_notations ADD COLUMN IF NOT EXISTS notes_embedding vector(1536);
ALTER TABLE collection_external_links_notations ADD COLUMN IF NOT EXISTS category_embedding vector(1536);
ALTER TABLE collection_external_links_notations ADD COLUMN IF NOT EXISTS combined_embedding vector(1536);
ALTER TABLE collection_external_links_notations ADD COLUMN IF NOT EXISTS vector_updated_at timestamp;

-- Add vector columns to link_groups table
ALTER TABLE link_groups ADD COLUMN IF NOT EXISTS name_embedding vector(1536);
ALTER TABLE link_groups ADD COLUMN IF NOT EXISTS description_embedding vector(1536);
ALTER TABLE link_groups ADD COLUMN IF NOT EXISTS category_embedding vector(1536);
ALTER TABLE link_groups ADD COLUMN IF NOT EXISTS combined_embedding vector(1536);
ALTER TABLE link_groups ADD COLUMN IF NOT EXISTS vector_updated_at timestamp;

-- Add vector columns to attachments table
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS title_embedding vector(1536);
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS description_embedding vector(1536);
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS combined_embedding vector(1536);
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS vector_updated_at timestamp; 