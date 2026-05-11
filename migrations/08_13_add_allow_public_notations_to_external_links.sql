-- Migration: Add allow_public_notations to external_links
-- Description: Allows external links to accept public notation submissions
-- Date: 2025-08-14

-- Add column to control whether external links can accept public notations
ALTER TABLE external_links
ADD COLUMN IF NOT EXISTS allow_public_notations BOOLEAN DEFAULT false;

-- Add index for performance when querying external links that allow public notations
CREATE INDEX IF NOT EXISTS idx_external_links_allow_public_notations 
ON external_links(allow_public_notations) 
WHERE allow_public_notations = true;

-- Add comment for documentation
COMMENT ON COLUMN external_links.allow_public_notations IS 
'When true, allows public users to submit notations via public forms/templates for this external link';