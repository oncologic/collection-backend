-- Add persisted Excalidraw whiteboards to external links.
ALTER TABLE external_links
ADD COLUMN IF NOT EXISTS whiteboard_data JSONB;

COMMENT ON COLUMN external_links.whiteboard_data IS 'Persisted Excalidraw scene data for the external link whiteboard';
