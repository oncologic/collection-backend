-- Drop the existing constraint
ALTER TABLE social_media_associations 
DROP CONSTRAINT IF EXISTS check_associated_type;

-- Add updated constraint that includes 'collection'
ALTER TABLE social_media_associations 
ADD CONSTRAINT check_associated_type 
CHECK (associated_type IN ('organization', 'resource', 'collection', 'collection_external_link'));