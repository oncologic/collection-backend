-- Ensure user types exist for advocate and patient
-- Only insert if they don't already exist
INSERT INTO user_types (name, description, created_at, updated_at)
SELECT 'patient', 'Patient user type', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM user_types WHERE name = 'patient');

INSERT INTO user_types (name, description, created_at, updated_at)
SELECT 'advocate', 'Advocate user type', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM user_types WHERE name = 'advocate');

-- Create tenant_invites table
CREATE TABLE IF NOT EXISTS tenant_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invite_token VARCHAR(255) NOT NULL UNIQUE,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  max_uses VARCHAR(50),
  use_count VARCHAR(50) DEFAULT '0',
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  revoked_at TIMESTAMP
);

-- Create tenant_invite_uses table to track who used each invite
CREATE TABLE IF NOT EXISTS tenant_invite_uses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id UUID NOT NULL REFERENCES tenant_invites(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_tenant_invites_tenant_id ON tenant_invites(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_invites_invite_token ON tenant_invites(invite_token);
CREATE INDEX IF NOT EXISTS idx_tenant_invites_is_active ON tenant_invites(is_active);
CREATE INDEX IF NOT EXISTS idx_tenant_invite_uses_invite_id ON tenant_invite_uses(invite_id);
CREATE INDEX IF NOT EXISTS idx_tenant_invite_uses_user_id ON tenant_invite_uses(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_invite_uses_tenant_id ON tenant_invite_uses(tenant_id);
