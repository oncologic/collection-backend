-- Add addedByUserId and visibility columns to tags table
ALTER TABLE tags
ADD COLUMN added_by_user_id UUID REFERENCES users(id),
ADD COLUMN visibility VARCHAR(20) DEFAULT 'private' CHECK (visibility IN ('private', 'tenant', 'public'));

-- Create indexes for efficient queries
CREATE INDEX idx_tags_added_by_user_id ON tags(added_by_user_id);
CREATE INDEX idx_tags_visibility ON tags(visibility);

-- Update existing tags to have 'tenant' visibility since they were created for specific tenants
UPDATE tags SET visibility = 'tenant' WHERE visibility IS NULL;