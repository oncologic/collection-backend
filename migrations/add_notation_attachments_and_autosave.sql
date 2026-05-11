-- Migration: Add notation attachments and auto-save support
-- Description: Creates junction table for notation attachments and adds draft/auto-save fields

-- Add auto-save related columns to notations table
ALTER TABLE collection_external_links_notations
ADD COLUMN IF NOT EXISTS draft_content TEXT,
ADD COLUMN IF NOT EXISTS last_auto_saved_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS is_draft BOOLEAN DEFAULT false;

-- Create junction table for notation attachments (inline images)
CREATE TABLE IF NOT EXISTS notation_attachments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    notation_id UUID NOT NULL REFERENCES collection_external_links_notations(id) ON DELETE CASCADE,
    attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    position INTEGER, -- Position in the document (for ordering)
    inline_metadata JSONB DEFAULT '{}', -- Store position, size, OCR results, etc.
    is_inline BOOLEAN DEFAULT true, -- Whether it's embedded in the content
    ocr_text TEXT, -- Extracted OCR text
    ocr_processed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(notation_id, attachment_id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_notation_attachments_notation_id
ON notation_attachments(notation_id);

CREATE INDEX IF NOT EXISTS idx_notation_attachments_attachment_id
ON notation_attachments(attachment_id);

CREATE INDEX IF NOT EXISTS idx_notation_attachments_position
ON notation_attachments(notation_id, position);

-- Add comments for documentation
COMMENT ON TABLE notation_attachments IS 'Links notations to their attachments, supporting inline images with OCR';
COMMENT ON COLUMN notation_attachments.position IS 'Order of attachment in the notation content';
COMMENT ON COLUMN notation_attachments.inline_metadata IS 'Stores display properties like width, height, alignment';
COMMENT ON COLUMN notation_attachments.ocr_text IS 'Extracted text from image OCR processing';
COMMENT ON COLUMN collection_external_links_notations.draft_content IS 'Auto-saved draft version of the notation';
COMMENT ON COLUMN collection_external_links_notations.last_auto_saved_at IS 'Timestamp of last auto-save';