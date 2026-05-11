-- Fix social media accounts account_type column issue
-- This migration handles the transition from account_type to account_type_id

-- First, make account_type nullable if it exists and is NOT NULL
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'social_media_accounts' 
        AND column_name = 'account_type'
        AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE social_media_accounts ALTER COLUMN account_type DROP NOT NULL;
    END IF;
END $$;

-- If we have both account_type and account_type_id, migrate data
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'social_media_accounts' 
        AND column_name = 'account_type'
    ) AND EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'social_media_accounts' 
        AND column_name = 'account_type_id'
    ) THEN
        -- Update account_type_id based on account_type values where needed
        UPDATE social_media_accounts sma
        SET account_type_id = smat.id
        FROM social_media_account_types smat
        WHERE sma.account_type_id IS NULL 
        AND sma.account_type IS NOT NULL
        AND (
            (sma.account_type = 'foundation' AND smat.name = 'Foundation/Organization')
            OR (sma.account_type = 'medical' AND smat.name = 'Healthcare Professional')
            OR (sma.account_type = 'advocate' AND smat.name = 'Patient Advocate')
            OR (sma.account_type = 'personal' AND smat.name = 'Personal')
            OR (sma.account_type = 'company' AND smat.name = 'Company')
            OR (sma.account_type = 'community' AND smat.name = 'Community')
        );
        
        -- Drop the old account_type column
        ALTER TABLE social_media_accounts DROP COLUMN IF EXISTS account_type;
    END IF;
END $$;

-- Ensure account_type_id exists and has a foreign key
ALTER TABLE social_media_accounts 
ADD COLUMN IF NOT EXISTS account_type_id UUID REFERENCES social_media_account_types(id);

-- Create index on account_type_id if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_social_media_accounts_account_type_id 
ON social_media_accounts(account_type_id);