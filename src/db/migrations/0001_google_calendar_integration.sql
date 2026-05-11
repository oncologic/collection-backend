-- Google Calendar Integration table
CREATE TABLE IF NOT EXISTS google_calendar_integrations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) UNIQUE,
  google_account_email VARCHAR(255) NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  sync_enabled BOOLEAN DEFAULT true,
  primary_calendar_id VARCHAR(255),
  selected_calendar_ids JSONB DEFAULT '[]',
  last_synced_at TIMESTAMP WITH TIME ZONE,
  sync_direction VARCHAR(20) DEFAULT 'both',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Google Calendar Events mapping table (updated to handle multiple entity types)
CREATE TABLE IF NOT EXISTS google_calendar_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type VARCHAR(50) NOT NULL, -- 'event', 'external_link', 'notation'
  entity_id UUID NOT NULL, -- ID of the event, external_link, or notation
  google_event_id VARCHAR(255) NOT NULL,
  google_calendar_id VARCHAR(255) NOT NULL,
  integration_id UUID NOT NULL REFERENCES google_calendar_integrations(id),
  sync_status VARCHAR(20) DEFAULT 'synced',
  last_synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  google_event_data JSONB,
  sync_direction VARCHAR(20) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(entity_type, entity_id, integration_id)
);

-- Sync log table
CREATE TABLE IF NOT EXISTS google_calendar_sync_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  integration_id UUID NOT NULL REFERENCES google_calendar_integrations(id),
  sync_type VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,
  events_processed JSONB DEFAULT '{"imported": 0, "exported": 0, "updated": 0, "deleted": 0}',
  errors JSONB DEFAULT '[]',
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Add Google Calendar indicator to events table
ALTER TABLE events ADD COLUMN IF NOT EXISTS is_google_calendar_event BOOLEAN DEFAULT false;

-- Add Google Calendar indicators to external_links and notations
ALTER TABLE external_links ADD COLUMN IF NOT EXISTS is_google_calendar_event BOOLEAN DEFAULT false;
ALTER TABLE collection_external_links_notations ADD COLUMN IF NOT EXISTS is_google_calendar_event BOOLEAN DEFAULT false;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_google_calendar_integrations_user_id ON google_calendar_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_events_entity ON google_calendar_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_events_integration_id ON google_calendar_events(integration_id);
CREATE INDEX IF NOT EXISTS idx_google_calendar_sync_logs_integration_id ON google_calendar_sync_logs(integration_id);