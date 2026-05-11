-- Allow rich-text notation content to store full HTML from the inline editor.
ALTER TABLE collection_external_links_notations
ALTER COLUMN notes TYPE TEXT;
