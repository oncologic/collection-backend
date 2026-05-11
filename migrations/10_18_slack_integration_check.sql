-- Check if Slack integration tables exist
-- Run this before applying the migration to see current state

SELECT 'Checking for existing Slack tables...' as status;

-- Check for slack_workspaces table
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'slack_workspaces'
    ) THEN 'Table slack_workspaces already exists'
    ELSE 'Table slack_workspaces does not exist - safe to create'
  END as slack_workspaces_status;

-- Check for slack_channel_configs table
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'slack_channel_configs'
    ) THEN 'Table slack_channel_configs already exists'
    ELSE 'Table slack_channel_configs does not exist - safe to create'
  END as slack_channel_configs_status;

-- Check for slack_notification_logs table
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'slack_notification_logs'
    ) THEN 'Table slack_notification_logs already exists'
    ELSE 'Table slack_notification_logs does not exist - safe to create'
  END as slack_notification_logs_status;

-- Check if tenants table exists (required dependency)
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'tenants'
    ) THEN 'Required table tenants exists ✓'
    ELSE 'ERROR: Required table tenants does not exist!'
  END as tenants_check;

-- Check if users table exists (required dependency)
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'users'
    ) THEN 'Required table users exists ✓'
    ELSE 'ERROR: Required table users does not exist!'
  END as users_check;

-- Check if collections table exists (required dependency)
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'collections'
    ) THEN 'Required table collections exists ✓'
    ELSE 'ERROR: Required table collections does not exist!'
  END as collections_check;

-- Check if external_links table exists (required dependency)
SELECT
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'external_links'
    ) THEN 'Required table external_links exists ✓'
    ELSE 'ERROR: Required table external_links does not exist!'
  END as external_links_check;