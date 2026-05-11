-- Migration: Add suggested_by_email field to resources table
-- Description: Stores email address of person who suggested the resource (for pending resources)

-- Add suggested_by_email column (nullable, only used for pending suggestions)
ALTER TABLE resources 
ADD COLUMN IF NOT EXISTS suggested_by_email VARCHAR(255);

-- Create index for querying by email if needed
CREATE INDEX IF NOT EXISTS idx_resources_suggested_by_email ON resources(suggested_by_email);

