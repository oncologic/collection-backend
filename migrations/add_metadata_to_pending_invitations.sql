-- Add metadata column to pending_invitations table to store additional invitation details
ALTER TABLE pending_invitations 
ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Add comment to explain the column
COMMENT ON COLUMN pending_invitations.metadata IS 'Additional metadata for the invitation, such as cascade settings for collection invitations';