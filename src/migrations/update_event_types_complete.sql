-- Comprehensive update to event_types table
-- This migration adds all missing columns to the event_types table

-- Add tenant_id column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='event_types' AND column_name='tenant_id') THEN
        ALTER TABLE event_types ADD COLUMN tenant_id UUID REFERENCES tenants(id);
    END IF;
END $$;

-- Add added_by_user_id column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='event_types' AND column_name='added_by_user_id') THEN
        ALTER TABLE event_types ADD COLUMN added_by_user_id UUID REFERENCES users(id);
    END IF;
END $$;

-- Add visibility column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='event_types' AND column_name='visibility') THEN
        ALTER TABLE event_types ADD COLUMN visibility VARCHAR(20) DEFAULT 'private' 
            CHECK (visibility IN ('private', 'tenant', 'public'));
    END IF;
END $$;

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_event_types_tenant_id ON event_types(tenant_id);
CREATE INDEX IF NOT EXISTS idx_event_types_added_by_user_id ON event_types(added_by_user_id);
CREATE INDEX IF NOT EXISTS idx_event_types_visibility ON event_types(visibility);

-- Update existing event types to have 'public' visibility since they were created by admins
UPDATE event_types SET visibility = 'public' WHERE visibility IS NULL;