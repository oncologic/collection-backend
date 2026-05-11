-- Create social_media_associations table for polymorphic associations
CREATE TABLE social_media_associations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    social_media_account_id UUID NOT NULL REFERENCES social_media_accounts(id) ON DELETE CASCADE,
    associated_id UUID NOT NULL,
    associated_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    tenant_id UUID REFERENCES tenants(id),
    -- Composite index for efficient queries
    CONSTRAINT social_media_associations_unique UNIQUE (social_media_account_id, associated_id, associated_type)
);

-- Create indexes for performance
CREATE INDEX idx_social_media_associations_associated ON social_media_associations(associated_id, associated_type);
CREATE INDEX idx_social_media_associations_social_media ON social_media_associations(social_media_account_id);
CREATE INDEX idx_social_media_associations_type ON social_media_associations(associated_type);
CREATE INDEX idx_social_media_associations_tenant ON social_media_associations(tenant_id);

-- Add check constraint to ensure valid associated types
ALTER TABLE social_media_associations 
ADD CONSTRAINT check_associated_type 
CHECK (associated_type IN ('organization', 'resource', 'collection_external_link'));

-- Add update trigger for updated_at
CREATE OR REPLACE FUNCTION update_social_media_associations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_social_media_associations_updated_at
BEFORE UPDATE ON social_media_associations
FOR EACH ROW
EXECUTE FUNCTION update_social_media_associations_updated_at();