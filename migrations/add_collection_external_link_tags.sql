-- Migration: Add tags support for collection external links
-- Description: Creates dedicated tags system for collections and external links

-- Create tag definitions table for collection/external link tags
CREATE TABLE IF NOT EXISTS collection_external_link_tag_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(136) NOT NULL,
    description TEXT,
    color VARCHAR(7), -- hex color code like #FF5733
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create junction table for collection external link tags
CREATE TABLE IF NOT EXISTS collection_external_link_tags (
    collection_external_link_id UUID NOT NULL REFERENCES collection_external_links(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES collection_external_link_tag_definitions(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (collection_external_link_id, tag_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_collection_external_link_tag_definitions_name ON collection_external_link_tag_definitions(name);
CREATE INDEX IF NOT EXISTS idx_collection_external_link_tag_definitions_tenant ON collection_external_link_tag_definitions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_collection_external_link_tag_definitions_created_by ON collection_external_link_tag_definitions(created_by_user_id);

CREATE INDEX IF NOT EXISTS idx_collection_external_link_tags_link_id ON collection_external_link_tags(collection_external_link_id);
CREATE INDEX IF NOT EXISTS idx_collection_external_link_tags_tag_id ON collection_external_link_tags(tag_id);

-- Add unique constraint to prevent duplicate tag names within a tenant
CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_external_link_tag_definitions_unique_name_tenant 
ON collection_external_link_tag_definitions(LOWER(name), tenant_id);

-- Add comments for documentation
COMMENT ON TABLE collection_external_link_tag_definitions IS 'Tag definitions specifically for collections and external links, separate from other tags';
COMMENT ON TABLE collection_external_link_tags IS 'Junction table linking collection external links to their tags';
COMMENT ON COLUMN collection_external_link_tag_definitions.color IS 'Hex color code for tag display (e.g., #FF5733)'; 