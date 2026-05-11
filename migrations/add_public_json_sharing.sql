-- Add public JSON sharing capability to collections and external_links
-- This allows specific collections and external links to be shared publicly via JSON API

-- Add publicJsonEnabled to collections table
ALTER TABLE collections 
ADD COLUMN public_json_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Add publicJsonEnabled to external_links table  
ALTER TABLE external_links
ADD COLUMN public_json_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Add index for performance on public queries
CREATE INDEX idx_collections_public_json_enabled ON collections(public_json_enabled) WHERE public_json_enabled = TRUE;
CREATE INDEX idx_external_links_public_json_enabled ON external_links(public_json_enabled) WHERE public_json_enabled = TRUE;

-- Add comments for documentation
COMMENT ON COLUMN collections.public_json_enabled IS 'When true, allows public JSON API access to this collection and its non-private external links';
COMMENT ON COLUMN external_links.public_json_enabled IS 'When true, allows public JSON API access to this external link when visibility is not private'; 