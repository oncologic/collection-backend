-- Add start/end date ranges for collections, external links, and notations.
-- Keep the legacy single-date columns for compatibility while backfilling the new range fields.

ALTER TABLE collections
ADD COLUMN IF NOT EXISTS start_date DATE,
ADD COLUMN IF NOT EXISTS end_date DATE;

ALTER TABLE collection_external_links
ADD COLUMN IF NOT EXISTS start_date DATE,
ADD COLUMN IF NOT EXISTS end_date DATE;

ALTER TABLE collection_external_links_notations
ADD COLUMN IF NOT EXISTS start_date DATE,
ADD COLUMN IF NOT EXISTS end_date DATE;

UPDATE collection_external_links
SET
  start_date = COALESCE(start_date, date),
  end_date = COALESCE(end_date, start_date, date)
WHERE date IS NOT NULL;

UPDATE collection_external_links_notations
SET
  start_date = COALESCE(start_date, date),
  end_date = COALESCE(end_date, start_date, date)
WHERE date IS NOT NULL;

UPDATE collections
SET end_date = COALESCE(end_date, start_date)
WHERE start_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_collections_start_end_date
ON collections(start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_collection_external_links_start_end_date
ON collection_external_links(start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_collection_external_links_notations_start_end_date
ON collection_external_links_notations(start_date, end_date);

COMMENT ON COLUMN collections.start_date IS 'Start date for collection calendar display';
COMMENT ON COLUMN collections.end_date IS 'End date for collection calendar display';
COMMENT ON COLUMN collection_external_links.start_date IS 'Start date for collection-specific external link calendar display';
COMMENT ON COLUMN collection_external_links.end_date IS 'End date for collection-specific external link calendar display';
COMMENT ON COLUMN collection_external_links_notations.start_date IS 'Start date for notation calendar display';
COMMENT ON COLUMN collection_external_links_notations.end_date IS 'End date for notation calendar display';
