-- Add instructions fields to opportunity_applications table
-- These fields allow admins/creators to provide instructions and links to approved applicants

ALTER TABLE opportunity_applications
ADD COLUMN IF NOT EXISTS instructions TEXT,
ADD COLUMN IF NOT EXISTS instructions_link TEXT;

-- Add comment to explain the fields
COMMENT ON COLUMN opportunity_applications.instructions IS 'Instructions or notes provided to the applicant when their application is approved';
COMMENT ON COLUMN opportunity_applications.instructions_link IS 'Link (URL) provided to the applicant with instructions when their application is approved';

