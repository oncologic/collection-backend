-- Migration to fix Google Calendar sync issues

-- 1. First, create Google Calendar event type if it doesn't exist
INSERT INTO event_types (name, description)
SELECT 'Google Calendar Event', 'Events synced from Google Calendar'
WHERE NOT EXISTS (
  SELECT 1 FROM event_types WHERE name = 'Google Calendar Event'
);

-- 2. Get the ID of the Google Calendar event type
-- You'll need to note this ID and update your code
SELECT id, name FROM event_types WHERE name = 'Google Calendar Event';

-- 3. Add unique constraint to prevent duplicate Google events
-- This ensures we can't have the same Google event ID multiple times for the same integration
ALTER TABLE google_calendar_events 
DROP CONSTRAINT IF EXISTS unique_google_event_per_integration;

ALTER TABLE google_calendar_events 
ADD CONSTRAINT unique_google_event_per_integration 
UNIQUE (google_event_id, integration_id, entity_type);

-- 4. Clean up duplicate events (keeping the oldest one)
WITH duplicates AS (
  SELECT 
    gce.id,
    gce.entity_id,
    gce.google_event_id,
    gce.integration_id,
    gce.created_at,
    ROW_NUMBER() OVER (
      PARTITION BY gce.google_event_id, gce.integration_id 
      ORDER BY gce.created_at ASC
    ) as rn
  FROM google_calendar_events gce
  WHERE gce.entity_type = 'event'
)
DELETE FROM events 
WHERE id IN (
  SELECT entity_id 
  FROM duplicates 
  WHERE rn > 1
);

-- 5. Clean up orphaned mappings
DELETE FROM google_calendar_events
WHERE entity_type = 'event' 
AND entity_id NOT IN (SELECT id FROM events);

-- 6. Update events with type_id = 9 to use the correct Google Calendar event type
-- Replace 'X' with the actual ID from step 2
UPDATE events 
SET type_id = (SELECT id FROM event_types WHERE name = 'Google Calendar Event')
WHERE is_google_calendar_event = true 
AND type_id = 9;

-- 7. Add index for better performance on duplicate checking
CREATE INDEX IF NOT EXISTS idx_google_calendar_events_lookup 
ON google_calendar_events(google_event_id, integration_id, entity_type);