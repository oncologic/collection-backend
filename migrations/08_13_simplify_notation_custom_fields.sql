-- Migration: Simplify notation custom fields implementation
-- This migration ensures we have the simple custom_fields approach on notations
-- and optionally removes the complex template system tables if not needed

-- STEP 1: Ensure the simple columns exist on collection_external_links_notations
-- ================================================================================

-- Check and add custom_fields column (stores all custom field data as JSONB)
ALTER TABLE collection_external_links_notations 
ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}';

-- Check and add is_template flag (marks a notation as a template)
ALTER TABLE collection_external_links_notations 
ADD COLUMN IF NOT EXISTS is_template BOOLEAN DEFAULT false;

-- Check and add template_id (optional reference to a template)
ALTER TABLE collection_external_links_notations 
ADD COLUMN IF NOT EXISTS template_id UUID;

-- Check and add submission_metadata (for tracking external submissions)
ALTER TABLE collection_external_links_notations 
ADD COLUMN IF NOT EXISTS submission_metadata JSONB DEFAULT '{}';

-- Add index for better performance on custom_fields queries
CREATE INDEX IF NOT EXISTS idx_notations_custom_fields 
ON collection_external_links_notations USING GIN (custom_fields);

-- Add index for template queries
CREATE INDEX IF NOT EXISTS idx_notations_is_template 
ON collection_external_links_notations (is_template) 
WHERE is_template = true;

-- STEP 2: Verify the columns were added
-- ======================================
SELECT 
    column_name, 
    data_type, 
    column_default,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'collection_external_links_notations'
AND column_name IN ('custom_fields', 'is_template', 'template_id', 'submission_metadata')
ORDER BY column_name;


DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'collection_external_links_notations' 
               AND column_name = 'custom_fields') THEN
        COMMENT ON COLUMN collection_external_links_notations.custom_fields IS 
        'Stores custom field definitions and values as JSONB. Format: {"fieldName": {"type": "text", "value": "...", "options": [...]}}';
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'collection_external_links_notations' 
               AND column_name = 'is_template') THEN
        COMMENT ON COLUMN collection_external_links_notations.is_template IS 
        'Boolean flag to mark a notation as a template that can be reused';
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'collection_external_links_notations' 
               AND column_name = 'template_id') THEN
        COMMENT ON COLUMN collection_external_links_notations.template_id IS 
        'Optional reference to a template notation (not currently used in simple implementation)';
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'collection_external_links_notations' 
               AND column_name = 'submission_metadata') THEN
        COMMENT ON COLUMN collection_external_links_notations.submission_metadata IS 
        'Additional metadata about how the notation was submitted';
    END IF;
END $$;

-- STEP 5: Show final state
-- ========================
SELECT 
    'Notation custom fields setup complete' as status,
    COUNT(*) as columns_added
FROM information_schema.columns 
WHERE table_name = 'collection_external_links_notations'
AND column_name IN ('custom_fields', 'is_template', 'template_id', 'submission_metadata');


 ALTER TABLE collection_external_links_notations
  ALTER COLUMN id SET DEFAULT gen_random_uuid();