-- Migration: Add access column to tenants
-- Description: Supports private/public tenant access mode used by admin tenant
-- management and public visibility checks.

ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS access VARCHAR(255);

UPDATE tenants
SET access = 'private'
WHERE access IS NULL;

ALTER TABLE tenants
ALTER COLUMN access SET DEFAULT 'private';

COMMENT ON COLUMN tenants.access IS
  'Tenant access mode. private = authenticated-only; public = can expose resources/events when settings.publicAccess allows it.';
