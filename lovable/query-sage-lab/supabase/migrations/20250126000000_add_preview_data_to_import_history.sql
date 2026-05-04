-- Add preview_data column to import_history table if it doesn't exist
-- This migration is safe to run even if the column already exists (from the initial migration)

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'import_history' 
        AND column_name = 'preview_data'
    ) THEN
        ALTER TABLE import_history 
        ADD COLUMN preview_data JSONB;
    END IF;
END $$;

