ALTER TABLE collections
  ADD COLUMN IF NOT EXISTS source_template_id uuid REFERENCES collections(id) ON DELETE SET NULL;

ALTER TABLE collections
  ADD COLUMN IF NOT EXISTS workflow_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE collection_external_links
  ADD COLUMN IF NOT EXISTS workflow_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_collections_source_template_id
  ON collections(source_template_id);

CREATE INDEX IF NOT EXISTS idx_collections_workflow_metadata_kind
  ON collections((workflow_metadata->>'kind'));

CREATE INDEX IF NOT EXISTS idx_collection_external_links_workflow_metadata_gin
  ON collection_external_links USING GIN (workflow_metadata);

COMMENT ON COLUMN collections.source_template_id IS 'Template collection used to create this workflow/project instance';
COMMENT ON COLUMN collections.workflow_metadata IS 'Workflow template/instance metadata such as kind, planning mode, and agent hints';
COMMENT ON COLUMN collection_external_links.workflow_metadata IS 'Workflow step metadata such as relative timing, duration, dependencies, owner, and completion criteria';
