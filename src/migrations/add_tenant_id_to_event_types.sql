-- Add tenantId column to event_types table for tenant-specific event types
ALTER TABLE event_types
ADD COLUMN tenant_id UUID REFERENCES tenants(id);

-- Create index for efficient tenant-based queries
CREATE INDEX idx_event_types_tenant_id ON event_types(tenant_id);

-- Update existing event types to belong to a default tenant if needed
-- This is commented out - adjust based on your data migration strategy
-- UPDATE event_types SET tenant_id = 'your-default-tenant-uuid' WHERE tenant_id IS NULL;