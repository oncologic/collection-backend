-- Add hasOnboarded column to users table
ALTER TABLE users
ADD COLUMN has_onboarded BOOLEAN NOT NULL DEFAULT false;

-- Update existing users to have hasOnboarded set to true
-- This assumes existing users have already gone through onboarding
UPDATE users
SET has_onboarded = true
WHERE has_onboarded IS NULL; 