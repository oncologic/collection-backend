DROP TABLE IF EXISTS google_calendar_sync_logs CASCADE;
DROP TABLE IF EXISTS google_calendar_events CASCADE;
DROP TABLE IF EXISTS google_calendar_integrations CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'is_google_calendar_event'
  ) THEN
    DELETE FROM events
    WHERE is_google_calendar_event = true;
  END IF;
END;
$$;

ALTER TABLE events
  DROP COLUMN IF EXISTS is_google_calendar_event;

ALTER TABLE external_links
  DROP COLUMN IF EXISTS is_google_calendar_event;

ALTER TABLE collection_external_links_notations
  DROP COLUMN IF EXISTS is_google_calendar_event;

DELETE FROM event_types event_type
WHERE event_type.name = 'Google Calendar Event'
  AND NOT EXISTS (
    SELECT 1
    FROM events
    WHERE events.type_id = event_type.id
  );
