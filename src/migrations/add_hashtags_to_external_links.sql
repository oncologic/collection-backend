-- Add hashtags column to external_links table
ALTER TABLE external_links 
ADD COLUMN IF NOT EXISTS hashtags TEXT;

-- Add comment for documentation
COMMENT ON COLUMN external_links.hashtags IS 'Comma-separated list of hashtags for social media tracking';