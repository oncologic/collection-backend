-- Migration: Add notation templates and custom fields support
-- Description: Extends notation system to support custom key-value fields and templates
-- This migration is idempotent - safe to run multiple times

-- Table for notation templates
CREATE TABLE IF NOT EXISTS notation_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    collection_external_link_id UUID REFERENCES collection_external_links(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    is_public_submission_template BOOLEAN DEFAULT false,
    created_by_user_id UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Table for template field definitions
CREATE TABLE IF NOT EXISTS notation_template_fields (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    template_id UUID REFERENCES notation_templates(id) ON DELETE CASCADE,
    field_key VARCHAR(255) NOT NULL,
    field_label VARCHAR(255) NOT NULL,
    field_type VARCHAR(50) NOT NULL CHECK (field_type IN ('text', 'textarea', 'select', 'multiselect', 'date', 'number', 'boolean', 'url', 'email')),
    field_options JSONB, -- For select/multiselect: [{value: "", label: ""}, ...]
    is_required BOOLEAN DEFAULT false,
    validation_rules JSONB, -- e.g., {min_length: 3, max_length: 100, pattern: "regex"}
    placeholder_text VARCHAR(500),
    help_text TEXT,
    display_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add template reference to notations
ALTER TABLE collection_external_links_notations 
ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES notation_templates(id) ON DELETE SET NULL;

-- Add custom fields data to notations
ALTER TABLE collection_external_links_notations 
ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}';

-- Add submission metadata for external submissions
ALTER TABLE collection_external_links_notations 
ADD COLUMN IF NOT EXISTS submission_metadata JSONB DEFAULT '{}';

-- Add is_template flag to mark notations as templates
ALTER TABLE collection_external_links_notations 
ADD COLUMN IF NOT EXISTS is_template BOOLEAN DEFAULT false;

-- Table for tracking external submissions
CREATE TABLE IF NOT EXISTS external_notation_submissions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    notation_id UUID REFERENCES collection_external_links_notations(id) ON DELETE CASCADE,
    template_id UUID REFERENCES notation_templates(id),
    submitter_email VARCHAR(255),
    submitter_name VARCHAR(255),
    submission_source VARCHAR(50) DEFAULT 'external', -- 'external', 'internal', 'api'
    submission_ip VARCHAR(45),
    submission_user_agent TEXT,
    submission_referrer TEXT,
    approval_status VARCHAR(50) DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
    reviewed_by_user_id UUID REFERENCES users(id),
    reviewed_at TIMESTAMP,
    review_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(notation_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_notation_templates_collection_external_link_id 
ON notation_templates(collection_external_link_id);

CREATE INDEX IF NOT EXISTS idx_notation_templates_is_public_submission 
ON notation_templates(is_public_submission_template) 
WHERE is_public_submission_template = true;

CREATE INDEX IF NOT EXISTS idx_notation_template_fields_template_id 
ON notation_template_fields(template_id);

CREATE INDEX IF NOT EXISTS idx_notations_template_id 
ON collection_external_links_notations(template_id);

CREATE INDEX IF NOT EXISTS idx_external_notation_submissions_template_id 
ON external_notation_submissions(template_id);

CREATE INDEX IF NOT EXISTS idx_external_notation_submissions_approval_status 
ON external_notation_submissions(approval_status);

CREATE INDEX IF NOT EXISTS idx_external_notation_submissions_notation_id 
ON external_notation_submissions(notation_id);

-- Add GIN index for JSONB custom_fields for efficient querying
CREATE INDEX IF NOT EXISTS idx_notations_custom_fields 
ON collection_external_links_notations USING GIN (custom_fields);

-- Add comments for documentation (using IF EXISTS to prevent errors on re-run)
DO $$ 
BEGIN
    -- Comments for notation_templates table
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notation_templates') THEN
        COMMENT ON TABLE notation_templates IS 'Stores notation templates that define the structure and fields for notations';
        COMMENT ON COLUMN notation_templates.is_public_submission_template IS 'Whether this template can be used for public submissions from external sources';
    END IF;

    -- Comments for notation_template_fields table
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'notation_template_fields') THEN
        COMMENT ON TABLE notation_template_fields IS 'Defines the custom fields for each notation template';
        COMMENT ON COLUMN notation_template_fields.field_type IS 'Type of input field: text, textarea, select, multiselect, date, number, boolean, url, email';
        COMMENT ON COLUMN notation_template_fields.field_options IS 'JSON array of options for select/multiselect fields';
        COMMENT ON COLUMN notation_template_fields.validation_rules IS 'JSON object containing validation rules for the field';
    END IF;

    -- Comments for collection_external_links_notations columns
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'collection_external_links_notations' 
               AND column_name = 'custom_fields') THEN
        COMMENT ON COLUMN collection_external_links_notations.custom_fields IS 'JSON object storing custom field values as key-value pairs';
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'collection_external_links_notations' 
               AND column_name = 'submission_metadata') THEN
        COMMENT ON COLUMN collection_external_links_notations.submission_metadata IS 'Additional metadata about how the notation was submitted';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns 
               WHERE table_name = 'collection_external_links_notations' 
               AND column_name = 'is_template') THEN
        COMMENT ON COLUMN collection_external_links_notations.is_template IS 'Boolean flag to mark a notation as a template';
    END IF;

    -- Comments for external_notation_submissions table
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'external_notation_submissions') THEN
        COMMENT ON TABLE external_notation_submissions IS 'Tracks external submissions of notations for auditing, approval workflow, and analytics';
        COMMENT ON COLUMN external_notation_submissions.approval_status IS 'Approval status: pending (awaiting review), approved (visible), or rejected (hidden)';
        COMMENT ON COLUMN external_notation_submissions.reviewed_by_user_id IS 'User who reviewed and approved/rejected the submission';
        COMMENT ON COLUMN external_notation_submissions.reviewed_at IS 'Timestamp when the submission was reviewed';
        COMMENT ON COLUMN external_notation_submissions.review_notes IS 'Optional notes from the reviewer about the approval decision';
    END IF;
END $$;

-- Final verification - show what columns exist
SELECT 
    column_name, 
    data_type, 
    column_default,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'collection_external_links_notations'
AND column_name IN ('template_id', 'custom_fields', 'submission_metadata', 'is_template')
ORDER BY column_name;