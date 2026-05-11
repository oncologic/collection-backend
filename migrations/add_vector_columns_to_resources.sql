-- Add pgvector extension for vector operations
-- This enables vector similarity search capabilities

-- Enable the pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add vector columns to resources table for semantic search
-- Using 1536 dimensions for OpenAI text-embedding-3-small or text-embedding-ada-002

-- Add vector columns to resources table
ALTER TABLE resources ADD COLUMN IF NOT EXISTS name_embedding vector(1536);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS description_embedding vector(1536);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS full_text_embedding vector(1536);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS combined_embedding vector(1536);

-- Add metadata column for tracking when vectors were last updated
ALTER TABLE resources ADD COLUMN IF NOT EXISTS vector_updated_at timestamp; 