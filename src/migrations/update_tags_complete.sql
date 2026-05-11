-- Comprehensive update to tags table
-- This migration adds all missing columns to the tags table

-- Add color column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='tags' AND column_name='color') THEN
        ALTER TABLE tags ADD COLUMN color VARCHAR(7);
    END IF;
END $$;

-- Add added_by_user_id column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='tags' AND column_name='added_by_user_id') THEN
        ALTER TABLE tags ADD COLUMN added_by_user_id UUID REFERENCES users(id);
    END IF;
END $$;

-- Add visibility column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name='tags' AND column_name='visibility') THEN
        ALTER TABLE tags ADD COLUMN visibility VARCHAR(20) DEFAULT 'private' 
            CHECK (visibility IN ('private', 'tenant', 'public'));
    END IF;
END $$;

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_tags_added_by_user_id ON tags(added_by_user_id);
CREATE INDEX IF NOT EXISTS idx_tags_visibility ON tags(visibility);

-- Set default colors for existing tags that don't have colors
UPDATE tags SET color = 
  CASE 
    WHEN id % 10 = 0 THEN '#3B82F6'  -- Blue
    WHEN id % 10 = 1 THEN '#10B981'  -- Green
    WHEN id % 10 = 2 THEN '#F59E0B'  -- Amber
    WHEN id % 10 = 3 THEN '#EF4444'  -- Red
    WHEN id % 10 = 4 THEN '#8B5CF6'  -- Purple
    WHEN id % 10 = 5 THEN '#EC4899'  -- Pink
    WHEN id % 10 = 6 THEN '#14B8A6'  -- Teal
    WHEN id % 10 = 7 THEN '#F97316'  -- Orange
    WHEN id % 10 = 8 THEN '#6366F1'  -- Indigo
    WHEN id % 10 = 9 THEN '#84CC16'  -- Lime
  END
WHERE color IS NULL;

-- Update existing tags to have 'tenant' visibility
UPDATE tags SET visibility = 'tenant' WHERE visibility IS NULL;