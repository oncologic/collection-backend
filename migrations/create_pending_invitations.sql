-- Migration: Create pending_invitations table
-- Description: Adds support for inviting users who don't have accounts yet

CREATE TABLE IF NOT EXISTS pending_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    invitee_name VARCHAR(255),
    inviter_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- What they're being invited to
    collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
    collection_external_link_id UUID REFERENCES collection_external_links(id) ON DELETE CASCADE,
    
    -- Invitation details
    role VARCHAR(50) NOT NULL DEFAULT 'editor',
    message TEXT,
    invite_token VARCHAR(255) NOT NULL UNIQUE,
    
    -- Status tracking
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, accepted, expired
    expires_at TIMESTAMP NOT NULL,
    accepted_at TIMESTAMP,
    accepted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_pending_invitations_email ON pending_invitations(email);
CREATE INDEX IF NOT EXISTS idx_pending_invitations_token ON pending_invitations(invite_token);
CREATE INDEX IF NOT EXISTS idx_pending_invitations_status ON pending_invitations(status);
CREATE INDEX IF NOT EXISTS idx_pending_invitations_expires_at ON pending_invitations(expires_at);
CREATE INDEX IF NOT EXISTS idx_pending_invitations_external_link ON pending_invitations(collection_external_link_id);

-- Add constraint to ensure valid status values
ALTER TABLE pending_invitations 
ADD CONSTRAINT chk_invitation_status 
CHECK (status IN ('pending', 'accepted', 'expired'));

-- Add constraint to ensure valid role values
ALTER TABLE pending_invitations 
ADD CONSTRAINT chk_invitation_role 
CHECK (role IN ('editor', 'admin'));

-- Add constraint to ensure expiration date is in the future when created
ALTER TABLE pending_invitations 
ADD CONSTRAINT chk_invitation_expires_future 
CHECK (expires_at > created_at);

-- Create a trigger to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_pending_invitations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_pending_invitations_updated_at
    BEFORE UPDATE ON pending_invitations
    FOR EACH ROW
    EXECUTE FUNCTION update_pending_invitations_updated_at(); 