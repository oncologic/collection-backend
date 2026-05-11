-- Add addedByUserId and visibility columns to event_types table
ALTER TABLE event_types
ADD COLUMN added_by_user_id UUID REFERENCES users(id),
ADD COLUMN visibility VARCHAR(20) DEFAULT 'private' CHECK (visibility IN ('private', 'tenant', 'public'));

-- Create indexes for efficient queries
CREATE INDEX idx_event_types_added_by_user_id ON event_types(added_by_user_id);
CREATE INDEX idx_event_types_visibility ON event_types(visibility);

-- Update existing event types to have 'public' visibility since they were created by admins
UPDATE event_types SET visibility = 'public' WHERE visibility IS NULL;