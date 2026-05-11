-- Add sorting functionality to collections
-- This migration adds sortOrder to collection_external_links and creates collection_type_ordering table

-- Add sortOrder column to collection_external_links table
ALTER TABLE collection_external_links 
ADD COLUMN sort_order INTEGER;

-- Create collection_type_ordering table
CREATE TABLE collection_type_ordering (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create unique index to ensure each type can only have one sort order per collection
CREATE UNIQUE INDEX collection_type_ordering_collection_type_unique 
ON collection_type_ordering(collection_id, type);

-- Add comment to explain the purpose
COMMENT ON TABLE collection_type_ordering IS 'Stores custom sort order for external link types within collections';
COMMENT ON COLUMN collection_external_links.sort_order IS 'Custom sort order for external links within their collection';



