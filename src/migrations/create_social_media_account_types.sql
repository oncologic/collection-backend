-- Create social media account types table
CREATE TABLE IF NOT EXISTS social_media_account_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    color VARCHAR(7),
    icon VARCHAR(50),
    visibility VARCHAR(50) DEFAULT 'private',
    added_by_user_id UUID REFERENCES users(id),
    tenant_id UUID REFERENCES tenants(id),
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_social_media_account_types_tenant_id ON social_media_account_types(tenant_id);
CREATE INDEX IF NOT EXISTS idx_social_media_account_types_visibility ON social_media_account_types(visibility);
CREATE INDEX IF NOT EXISTS idx_social_media_account_types_added_by ON social_media_account_types(added_by_user_id);

-- Insert default account types only if they don't exist
INSERT INTO social_media_account_types (name, description, color, icon, visibility, is_default) 
SELECT * FROM (
    VALUES
    ('Foundation/Organization', 'Official foundation or organization account', '#4B5563', 'FaBuilding', 'public', true),
    ('Healthcare Professional', 'Medical professional or healthcare provider', '#059669', 'FaUserMd', 'public', true),
    ('Patient Advocate', 'Patient advocate or survivor', '#DC2626', 'FaHandHoldingHeart', 'public', true),
    ('Personal', 'Personal account', '#3B82F6', 'FaUser', 'public', true),
    ('Company', 'Company or business account', '#7C3AED', 'FaBriefcase', 'public', true),
    ('Community', 'Community or support group', '#F59E0B', 'FaUsers', 'public', true)
) AS v(name, description, color, icon, visibility, is_default)
WHERE NOT EXISTS (
    SELECT 1 FROM social_media_account_types WHERE name = v.name
);

-- Add account_type_id column if it doesn't exist
ALTER TABLE social_media_accounts 
ADD COLUMN IF NOT EXISTS account_type_id UUID REFERENCES social_media_account_types(id);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS update_social_media_account_types_updated_at ON social_media_account_types;
CREATE TRIGGER update_social_media_account_types_updated_at 
    BEFORE UPDATE ON social_media_account_types 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();