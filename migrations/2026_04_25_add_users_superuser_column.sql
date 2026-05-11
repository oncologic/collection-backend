-- Migration: Add superuser column to users
-- Description: Allows database-level elevation for cross-tenant user
-- management without exposing superuser assignment through API updates.

ALTER TABLE users
ADD COLUMN IF NOT EXISTS superuser BOOLEAN;

UPDATE users
SET superuser = FALSE
WHERE superuser IS NULL;

ALTER TABLE users
ALTER COLUMN superuser SET DEFAULT FALSE;

ALTER TABLE users
ALTER COLUMN superuser SET NOT NULL;

COMMENT ON COLUMN users.superuser IS
  'Database-managed privilege flag. Only set manually at the database level; never writable through public API update calls.';
