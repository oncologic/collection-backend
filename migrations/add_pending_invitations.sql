-- Migration: Add pending invitations table
-- This table stores invitations for users who don't have accounts yet

CREATE TABLE pending_invitations (
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
    accepted_by_user_id UUID REFERENCES users(id),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX idx_pending_invitations_email ON pending_invitations(email);
CREATE INDEX idx_pending_invitations_token ON pending_invitations(invite_token);
CREATE INDEX idx_pending_invitations_status ON pending_invitations(status);
CREATE INDEX idx_pending_invitations_expires_at ON pending_invitations(expires_at);

-- Create a composite index for email + status queries
CREATE INDEX idx_pending_invitations_email_status ON pending_invitations(email, status);

-- Add constraint to ensure either collection_id or collection_external_link_id is set
ALTER TABLE pending_invitations ADD CONSTRAINT check_invitation_target 
CHECK (
    (collection_id IS NOT NULL AND collection_external_link_id IS NULL) OR 
    (collection_id IS NULL AND collection_external_link_id IS NOT NULL)
); 