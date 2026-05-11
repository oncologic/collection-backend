-- Migration: Add public access visibility settings to tenants
-- Description: Allows tenants to configure whether resources and events are publicly accessible

-- Update all existing tenants to have default visibility settings (private by default)
-- Note: After running this migration, you'll need to manually update the kidney cancer tenant
-- to enable public access if desired. Example:
-- UPDATE tenants 
-- SET settings = COALESCE(settings, '{}'::jsonb) || 
--   jsonb_build_object('publicAccess', jsonb_build_object('resources', true, 'events', true))
-- WHERE id = '<kidney-tenant-id>';

UPDATE tenants 
SET settings = COALESCE(settings, '{}'::jsonb) || 
  jsonb_build_object('publicAccess', jsonb_build_object('resources', false, 'events', false))
WHERE settings IS NULL 
   OR NOT (settings ? 'publicAccess');

-- Add comment to document the settings structure
COMMENT ON COLUMN tenants.settings IS 'JSONB field storing tenant configuration. publicAccess.resources and publicAccess.events control public visibility. true = public access allowed, false = requires authentication.';

