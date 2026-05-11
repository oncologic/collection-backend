-- Single comprehensive migration for metadata visibility and tracking features
-- This migration updates both event_types and tags tables with all necessary columns

-- ========================================
-- UPDATE EVENT_TYPES TABLE
-- ========================================

-- Add tenant_id column
ALTER TABLE event_types ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

-- Add added_by_user_id column
ALTER TABLE event_types ADD COLUMN IF NOT EXISTS added_by_user_id UUID REFERENCES users(id);

-- Add visibility column
ALTER TABLE event_types ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) DEFAULT 'private' 
    CHECK (visibility IN ('private', 'tenant', 'public'));

-- Create indexes for event_types
CREATE INDEX IF NOT EXISTS idx_event_types_tenant_id ON event_types(tenant_id);
CREATE INDEX IF NOT EXISTS idx_event_types_added_by_user_id ON event_types(added_by_user_id);
CREATE INDEX IF NOT EXISTS idx_event_types_visibility ON event_types(visibility);

-- Update existing event types to have 'public' visibility since they were created by admins
UPDATE event_types SET visibility = 'public' WHERE visibility IS NULL;

-- ========================================
-- UPDATE TAGS TABLE
-- ========================================

-- Add color column
ALTER TABLE tags ADD COLUMN IF NOT EXISTS color VARCHAR(7);

-- Add added_by_user_id column
ALTER TABLE tags ADD COLUMN IF NOT EXISTS added_by_user_id UUID REFERENCES users(id);

-- Add visibility column
ALTER TABLE tags ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) DEFAULT 'private' 
    CHECK (visibility IN ('private', 'tenant', 'public'));

-- Create indexes for tags
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