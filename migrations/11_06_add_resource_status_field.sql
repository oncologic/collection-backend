-- Migration: Add status field to resources table for pending resource suggestions
-- Description: Allows resources to be in pending state for admin/advocate approval

-- Add status column with default 'approved' to maintain backward compatibility
ALTER TABLE resources 
ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'approved' NOT NULL;

-- Add constraint to ensure valid status values
ALTER TABLE resources 
ADD CONSTRAINT chk_resource_status 
CHECK (status IN ('pending', 'approved', 'rejected'));

-- Create index for better performance when querying pending resources
CREATE INDEX IF NOT EXISTS idx_resources_status ON resources(status);

-- Create index for querying pending resources by tenant
CREATE INDEX IF NOT EXISTS idx_resources_status_tenant ON resources(status, tenant_id);

-- Update existing resources to have approved status (they're already visible)
UPDATE resources SET status = 'approved' WHERE status IS NULL OR status = '';

