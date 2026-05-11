-- Migration to support anonymous (email-based) opportunity applications
-- This allows people to apply without creating an account

-- First, drop the existing unique constraint on (opportunity_id, user_id)
-- since user_id can now be null
-- PostgreSQL creates constraint names like: table_column1_column2_key
-- Use IF EXISTS to avoid errors if constraint doesn't exist
ALTER TABLE opportunity_applications 
DROP CONSTRAINT IF EXISTS opportunity_applications_opportunity_id_user_id_key;

-- Make user_id nullable to support anonymous applications
ALTER TABLE opportunity_applications 
ALTER COLUMN user_id DROP NOT NULL;

-- Add email and name fields for anonymous applicants
ALTER TABLE opportunity_applications 
ADD COLUMN IF NOT EXISTS applicant_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS applicant_name VARCHAR(255);

-- Add a check constraint to ensure either user_id or applicant_email is provided
ALTER TABLE opportunity_applications 
ADD CONSTRAINT check_user_or_email 
CHECK (
  (user_id IS NOT NULL) OR (applicant_email IS NOT NULL)
);

-- Create a partial unique index to prevent duplicate applications
-- For authenticated users: one application per user per opportunity
CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_applications_user_unique 
ON opportunity_applications(opportunity_id, user_id) 
WHERE user_id IS NOT NULL;

-- For anonymous users: one application per email per opportunity
CREATE UNIQUE INDEX IF NOT EXISTS idx_opportunity_applications_email_unique 
ON opportunity_applications(opportunity_id, applicant_email) 
WHERE applicant_email IS NOT NULL;

