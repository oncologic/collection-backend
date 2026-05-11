-- Migration: Add resources support for collection external links
-- Description: Creates junction table to link resources to specific external links within collections

-- Create junction table for collection external link resources
CREATE TABLE IF NOT EXISTS collection_external_link_resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id UUID NOT NULL,
    external_link_id UUID NOT NULL,
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    notes TEXT,
    order_position INTEGER DEFAULT 0,
    user_added_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    organization_added_by_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign key to collection_external_links composite key
    FOREIGN KEY (collection_id, external_link_id) 
        REFERENCES collection_external_links(collection_id, external_link_id) 
        ON DELETE CASCADE,
    
    -- Ensure each resource is only added once per collection external link
    CONSTRAINT unique_collection_external_link_resource 
        UNIQUE(collection_id, external_link_id, resource_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_collection_external_link_resources_collection_external_link 
    ON collection_external_link_resources(collection_id, external_link_id);

CREATE INDEX IF NOT EXISTS idx_collection_external_link_resources_resource 
    ON collection_external_link_resources(resource_id);

CREATE INDEX IF NOT EXISTS idx_collection_external_link_resources_user_added 
    ON collection_external_link_resources(user_added_by_id);

CREATE INDEX IF NOT EXISTS idx_collection_external_link_resources_org_added 
    ON collection_external_link_resources(organization_added_by_id);

CREATE INDEX IF NOT EXISTS idx_collection_external_link_resources_created_at 
    ON collection_external_link_resources(created_at);

CREATE INDEX IF NOT EXISTS idx_collection_external_link_resources_order 
    ON collection_external_link_resources(order_position);

-- Add comments for documentation
COMMENT ON TABLE collection_external_link_resources IS 'Junction table linking resources to specific external links within collections';
COMMENT ON COLUMN collection_external_link_resources.notes IS 'Optional notes about why this resource is relevant to this external link';
COMMENT ON COLUMN collection_external_link_resources.order_position IS 'Display order of resources for a given external link (lower numbers appear first)';
COMMENT ON COLUMN collection_external_link_resources.user_added_by_id IS 'User who added this resource to the external link';
COMMENT ON COLUMN collection_external_link_resources.organization_added_by_id IS 'Organization context when the resource was added';

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_collection_external_link_resources_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_collection_external_link_resources_updated_at
    BEFORE UPDATE ON collection_external_link_resources
    FOR EACH ROW
    EXECUTE FUNCTION update_collection_external_link_resources_updated_at();