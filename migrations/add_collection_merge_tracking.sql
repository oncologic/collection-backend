-- Migration to add collection merge tracking table
-- This table logs merge operations for audit and history purposes

CREATE TABLE IF NOT EXISTS collection_merges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_collection_id UUID NOT NULL,
  target_collection_id UUID NOT NULL REFERENCES collections(id),
  merge_type VARCHAR(50) NOT NULL DEFAULT 'full', -- 'full', 'partial'
  source_deleted BOOLEAN NOT NULL DEFAULT false,
  merge_metadata JSONB, -- Store counts and other merge details
  merged_by_user_id UUID REFERENCES users(id),
  merged_by_organization_id UUID REFERENCES organizations(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for querying merge history
CREATE INDEX idx_collection_merges_target ON collection_merges(target_collection_id);
CREATE INDEX idx_collection_merges_source ON collection_merges(source_collection_id);
CREATE INDEX idx_collection_merges_user ON collection_merges(merged_by_user_id);
CREATE INDEX idx_collection_merges_created_at ON collection_merges(created_at);

-- Add comment
COMMENT ON TABLE collection_merges IS 'Tracks collection merge operations for audit trail';