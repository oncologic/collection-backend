CREATE UNIQUE INDEX IF NOT EXISTS idx_social_media_associations_unique_entity
ON social_media_associations (
  social_media_account_id,
  associated_id,
  associated_type
);
