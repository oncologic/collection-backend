-- First, check if the table exists
DO $$ 
BEGIN
    -- Add missing columns one by one with proper checks
    
    -- Add created_at if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'collection_collaborators' 
                   AND column_name = 'created_at') THEN
        ALTER TABLE collection_collaborators ADD COLUMN created_at TIMESTAMP DEFAULT NOW();
    END IF;
    
    -- Add updated_at if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'collection_collaborators' 
                   AND column_name = 'updated_at') THEN
        ALTER TABLE collection_collaborators ADD COLUMN updated_at TIMESTAMP DEFAULT NOW();
    END IF;
    
    -- Add created_by_user_id if it doesn't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'collection_collaborators' 
                   AND column_name = 'created_by_user_id') THEN
        ALTER TABLE collection_collaborators ADD COLUMN created_by_user_id UUID REFERENCES users(id);
    END IF;
    
    -- Add permission columns if they don't exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'collection_collaborators' 
                   AND column_name = 'can_add_resources') THEN
        ALTER TABLE collection_collaborators ADD COLUMN can_add_resources BOOLEAN DEFAULT true;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'collection_collaborators' 
                   AND column_name = 'can_add_links') THEN
        ALTER TABLE collection_collaborators ADD COLUMN can_add_links BOOLEAN DEFAULT true;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'collection_collaborators' 
                   AND column_name = 'can_add_notes') THEN
        ALTER TABLE collection_collaborators ADD COLUMN can_add_notes BOOLEAN DEFAULT true;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'collection_collaborators' 
                   AND column_name = 'can_add_attachments') THEN
        ALTER TABLE collection_collaborators ADD COLUMN can_add_attachments BOOLEAN DEFAULT true;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'collection_collaborators' 
                   AND column_name = 'can_manage_collaborators') THEN
        ALTER TABLE collection_collaborators ADD COLUMN can_manage_collaborators BOOLEAN DEFAULT false;
    END IF;
    
END $$;

-- Add comments to explain the columns
COMMENT ON COLUMN collection_collaborators.created_by_user_id IS 'User who added this collaborator';
COMMENT ON COLUMN collection_collaborators.can_add_resources IS 'Whether the collaborator can add resources to the collection';
COMMENT ON COLUMN collection_collaborators.can_add_links IS 'Whether the collaborator can add external links to the collection';
COMMENT ON COLUMN collection_collaborators.can_add_notes IS 'Whether the collaborator can add notes to items in the collection';
COMMENT ON COLUMN collection_collaborators.can_add_attachments IS 'Whether the collaborator can add attachments to items in the collection';
COMMENT ON COLUMN collection_collaborators.can_manage_collaborators IS 'Whether the collaborator can invite/remove other collaborators';

-- Show the final table structure
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM 
    information_schema.columns
WHERE 
    table_name = 'collection_collaborators'
ORDER BY 
    ordinal_position;