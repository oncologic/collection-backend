-- Migration: Add tags support for collection external link notations
-- Description: Creates junction table to link notations to existing tags

-- Create junction table for collection external link notation tags
CREATE TABLE IF NOT EXISTS collection_external_link_notation_tags (
    notation_id UUID NOT NULL REFERENCES collection_external_links_notations(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES collection_external_link_tag_definitions(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (notation_id, tag_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_collection_external_link_notation_tags_notation_id 
ON collection_external_link_notation_tags(notation_id);

CREATE INDEX IF NOT EXISTS idx_collection_external_link_notation_tags_tag_id 
ON collection_external_link_notation_tags(tag_id);

-- Add comments for documentation
COMMENT ON TABLE collection_external_link_notation_tags IS 'Junction table linking collection external link notations to their tags, reusing existing tag definitions';
COMMENT ON COLUMN collection_external_link_notation_tags.notation_id IS 'Reference to the notation being tagged';
COMMENT ON COLUMN collection_external_link_notation_tags.tag_id IS 'Reference to the tag definition from collection_external_link_tag_definitions'; 