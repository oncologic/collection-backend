ALTER TABLE resources
ADD COLUMN IF NOT EXISTS duration_value numeric(10,2),
ADD COLUMN IF NOT EXISTS duration_unit varchar(30);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'resources_duration_value_positive'
  ) THEN
    ALTER TABLE resources
    ADD CONSTRAINT resources_duration_value_positive
    CHECK (duration_value IS NULL OR duration_value > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'resources_duration_unit_required_with_value'
  ) THEN
    ALTER TABLE resources
    ADD CONSTRAINT resources_duration_unit_required_with_value
    CHECK (
      (duration_value IS NULL AND duration_unit IS NULL)
      OR
      (duration_value IS NOT NULL AND duration_unit IS NOT NULL)
    );
  END IF;
END $$;
