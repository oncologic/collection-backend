-- Add missing columns to collection_collaborators table
ALTER TABLE collection_collaborators 
ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id),
ADD COLUMN IF NOT EXISTS can_add_resources BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS can_add_links BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS can_add_notes BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS can_add_attachments BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS can_manage_collaborators BOOLEAN DEFAULT false;

-- Add timestamps if they don't exist
ALTER TABLE collection_collaborators 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Add a comment to explain the columns
COMMENT ON COLUMN collection_collaborators.created_by_user_id IS 'User who added this collaborator';
COMMENT ON COLUMN collection_collaborators.can_add_resources IS 'Whether the collaborator can add resources to the collection';
COMMENT ON COLUMN collection_collaborators.can_add_links IS 'Whether the collaborator can add external links to the collection';
COMMENT ON COLUMN collection_collaborators.can_add_notes IS 'Whether the collaborator can add notes to items in the collection';
COMMENT ON COLUMN collection_collaborators.can_add_attachments IS 'Whether the collaborator can add attachments to items in the collection';
COMMENT ON COLUMN collection_collaborators.can_manage_collaborators IS 'Whether the collaborator can invite/remove other collaborators';