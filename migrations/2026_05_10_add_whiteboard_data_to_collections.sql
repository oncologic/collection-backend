-- Add persisted whiteboard scene data to collections.
ALTER TABLE collections
ADD COLUMN IF NOT EXISTS whiteboard_data JSONB;

COMMENT ON COLUMN collections.whiteboard_data IS 'Persisted Excalidraw scene data for the collection whiteboard';
