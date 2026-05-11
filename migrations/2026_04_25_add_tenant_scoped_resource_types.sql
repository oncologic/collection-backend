ALTER TABLE resource_types
ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);

ALTER TABLE resource_types
ADD COLUMN IF NOT EXISTS added_by_user_id uuid;

ALTER TABLE resource_types
ADD COLUMN IF NOT EXISTS visibility varchar(20) DEFAULT 'tenant';

UPDATE resource_types
SET visibility = 'tenant'
WHERE visibility IS NULL;

CREATE INDEX IF NOT EXISTS idx_resource_types_tenant_id
ON resource_types (tenant_id);

CREATE INDEX IF NOT EXISTS idx_resource_types_visibility
ON resource_types (visibility);

CREATE INDEX IF NOT EXISTS idx_resource_types_added_by_user_id
ON resource_types (added_by_user_id);

CREATE INDEX IF NOT EXISTS idx_resource_types_tenant_name
ON resource_types (tenant_id, lower(name));
