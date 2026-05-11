-- Add color column to tags table
ALTER TABLE tags
ADD COLUMN color VARCHAR(7);

-- Set default colors for existing tags
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