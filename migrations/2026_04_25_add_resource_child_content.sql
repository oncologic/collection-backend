CREATE TABLE IF NOT EXISTS resource_attachments (
  resource_id uuid NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  attachment_id uuid NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  highlighted boolean DEFAULT false,
  sort_order integer DEFAULT 0,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS resource_attachments_resource_attachment_unique
  ON resource_attachments(resource_id, attachment_id);

CREATE INDEX IF NOT EXISTS resource_attachments_resource_idx
  ON resource_attachments(resource_id);

CREATE INDEX IF NOT EXISTS resource_attachments_attachment_idx
  ON resource_attachments(attachment_id);

ALTER TABLE link_groups
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);

CREATE INDEX IF NOT EXISTS link_groups_tenant_linking_idx
  ON link_groups(tenant_id, linking_type, linking_id);
