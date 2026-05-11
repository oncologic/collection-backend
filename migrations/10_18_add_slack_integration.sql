-- Slack Integration Tables
-- Created: October 18, 2024
-- This migration adds support for Slack notifications in collections and external links

-- 1. Create Slack workspaces table
-- Stores OAuth tokens and workspace configuration
CREATE TABLE IF NOT EXISTS slack_workspaces (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Slack OAuth data
  team_id VARCHAR(255) NOT NULL,
  team_name VARCHAR(255),
  bot_user_id VARCHAR(255),
  bot_access_token TEXT NOT NULL, -- Should be encrypted in production

  -- App installation info
  app_id VARCHAR(255),
  scope TEXT,

  -- Configuration
  is_active BOOLEAN DEFAULT true,
  default_channel_id VARCHAR(255),
  default_channel_name VARCHAR(255),

  -- Notification settings
  notify_on_new_external_link BOOLEAN DEFAULT true,
  notify_on_new_notation BOOLEAN DEFAULT true,
  notify_on_new_collaborator BOOLEAN DEFAULT false,

  -- Metadata
  installed_by_user_id UUID REFERENCES users(id),
  installed_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Store available channels for quick access
  available_channels JSONB DEFAULT '[]'::jsonb,

  -- Ensure unique workspace per tenant
  UNIQUE(team_id, tenant_id)
);

-- 2. Create Slack channel configurations table
-- Maps collections and external links to specific Slack channels
CREATE TABLE IF NOT EXISTS slack_channel_configs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slack_workspace_id UUID NOT NULL REFERENCES slack_workspaces(id) ON DELETE CASCADE,

  -- Link to either collection or external link (one must be set)
  collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
  external_link_id UUID REFERENCES external_links(id) ON DELETE CASCADE,

  -- Slack channel configuration
  channel_id VARCHAR(255) NOT NULL,
  channel_name VARCHAR(255),

  -- Notification preferences
  notify_on_new_external_link BOOLEAN DEFAULT true,
  notify_on_new_notation BOOLEAN DEFAULT true,
  notify_on_new_attachment BOOLEAN DEFAULT false,
  notify_on_status_change BOOLEAN DEFAULT false,

  -- Custom message templates (optional)
  custom_message_template JSONB,

  -- Metadata
  is_active BOOLEAN DEFAULT true,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Constraints
  CHECK (collection_id IS NOT NULL OR external_link_id IS NOT NULL),
  UNIQUE(collection_id, slack_workspace_id),
  UNIQUE(external_link_id, slack_workspace_id)
);

-- 3. Create notification logs table
-- Tracks all sent notifications for audit and debugging
CREATE TABLE IF NOT EXISTS slack_notification_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slack_workspace_id UUID REFERENCES slack_workspaces(id) ON DELETE SET NULL,
  channel_id VARCHAR(255),

  -- What triggered this notification
  event_type VARCHAR(50) NOT NULL, -- 'new_external_link', 'new_notation', etc
  entity_type VARCHAR(50), -- 'collection', 'external_link', 'notation'
  entity_id UUID,

  -- Notification details
  message_ts VARCHAR(255), -- Slack message timestamp
  message_content JSONB,
  success BOOLEAN DEFAULT true,
  error_message TEXT,

  -- Metadata
  sent_at TIMESTAMP DEFAULT NOW(),
  sent_by_user_id UUID REFERENCES users(id)
);

-- 4. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_slack_workspaces_tenant
  ON slack_workspaces(tenant_id);

CREATE INDEX IF NOT EXISTS idx_slack_workspaces_team
  ON slack_workspaces(team_id);

CREATE INDEX IF NOT EXISTS idx_slack_channel_configs_collection
  ON slack_channel_configs(collection_id);

CREATE INDEX IF NOT EXISTS idx_slack_channel_configs_external_link
  ON slack_channel_configs(external_link_id);

CREATE INDEX IF NOT EXISTS idx_slack_channel_configs_workspace
  ON slack_channel_configs(slack_workspace_id);

CREATE INDEX IF NOT EXISTS idx_slack_logs_workspace
  ON slack_notification_logs(slack_workspace_id);

CREATE INDEX IF NOT EXISTS idx_slack_logs_sent_at
  ON slack_notification_logs(sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_slack_logs_entity
  ON slack_notification_logs(entity_type, entity_id);

-- 5. Add comments for documentation
COMMENT ON TABLE slack_workspaces IS 'Stores Slack workspace integrations for each tenant';
COMMENT ON TABLE slack_channel_configs IS 'Maps collections and external links to Slack channels for notifications';
COMMENT ON TABLE slack_notification_logs IS 'Audit log of all Slack notifications sent';

COMMENT ON COLUMN slack_workspaces.bot_access_token IS 'Encrypted Slack bot token - must be encrypted in production';
COMMENT ON COLUMN slack_workspaces.available_channels IS 'Cached list of channels the bot can access';
COMMENT ON COLUMN slack_channel_configs.custom_message_template IS 'Optional custom formatting for notification messages';
COMMENT ON COLUMN slack_notification_logs.message_ts IS 'Slack message timestamp for threading/updates';

-- 6. Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_slack_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. Create triggers for updated_at
CREATE TRIGGER update_slack_workspaces_updated_at
  BEFORE UPDATE ON slack_workspaces
  FOR EACH ROW
  EXECUTE FUNCTION update_slack_updated_at();

CREATE TRIGGER update_slack_channel_configs_updated_at
  BEFORE UPDATE ON slack_channel_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_slack_updated_at();

-- 8. Grant appropriate permissions (adjust based on your user roles)
-- Example: Grant read access to authenticated users, write access to admins
-- GRANT SELECT ON slack_workspaces TO authenticated_user;
-- GRANT SELECT ON slack_channel_configs TO authenticated_user;
-- GRANT SELECT ON slack_notification_logs TO authenticated_user;
-- GRANT ALL ON slack_workspaces TO admin_user;
-- GRANT ALL ON slack_channel_configs TO admin_user;
-- GRANT ALL ON slack_notification_logs TO admin_user;