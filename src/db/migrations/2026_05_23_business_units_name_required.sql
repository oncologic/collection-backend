UPDATE organizations
SET name = CONCAT('Untitled Business Unit ', id::text)
WHERE name IS NULL OR length(trim(name)) = 0;

ALTER TABLE organizations
  ALTER COLUMN name SET NOT NULL;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_name_not_blank
  CHECK (length(trim(name)) > 0);
