-- Rollback migration for Slack Integration
-- This will remove all Slack-related tables and data

-- WARNING: This will permanently delete all Slack integration data
-- Make sure to backup any important data before running this rollback

-- 1. Drop triggers first
DROP TRIGGER IF EXISTS update_slack_workspaces_updated_at ON slack_workspaces;
DROP TRIGGER IF EXISTS update_slack_channel_configs_updated_at ON slack_channel_configs;

-- 2. Drop the update function (only if not used by other tables)
-- DROP FUNCTION IF EXISTS update_slack_updated_at();

-- 3. Drop indexes
DROP INDEX IF EXISTS idx_slack_workspaces_tenant;
DROP INDEX IF EXISTS idx_slack_workspaces_team;
DROP INDEX IF EXISTS idx_slack_channel_configs_collection;
DROP INDEX IF EXISTS idx_slack_channel_configs_external_link;
DROP INDEX IF EXISTS idx_slack_channel_configs_workspace;
DROP INDEX IF EXISTS idx_slack_logs_workspace;
DROP INDEX IF EXISTS idx_slack_logs_sent_at;
DROP INDEX IF EXISTS idx_slack_logs_entity;

-- 4. Drop tables in reverse order of dependencies
DROP TABLE IF EXISTS slack_notification_logs;
DROP TABLE IF EXISTS slack_channel_configs;
DROP TABLE IF EXISTS slack_workspaces;

-- 5. Optional: Log the rollback
-- INSERT INTO migration_log (migration_name, action, executed_at)
-- VALUES ('10_18_add_slack_integration', 'rollback', NOW());