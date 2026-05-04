-- Create import_history table to track data imports
CREATE TABLE IF NOT EXISTS import_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    connection_id UUID REFERENCES connections(id) ON DELETE SET NULL,
    filename TEXT NOT NULL,
    table_name TEXT NOT NULL,
    schema_name TEXT,
    rows_imported INTEGER NOT NULL DEFAULT 0,
    rows_failed INTEGER NOT NULL DEFAULT 0,
    total_rows INTEGER NOT NULL DEFAULT 0,
    duplicate_handling TEXT DEFAULT 'error', -- 'error', 'skip', or 'update'
    mapping JSONB, -- Store the column mapping
    file_columns JSONB, -- Store file column types
    warnings TEXT[], -- Array of warning messages
    error_summary TEXT, -- Summary of errors if any
    preview_data JSONB, -- Store preview data (first 10 rows) for display in history
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    CONSTRAINT valid_duplicate_handling CHECK (duplicate_handling IN ('error', 'skip', 'update'))
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_import_history_user_id ON import_history(user_id);
CREATE INDEX IF NOT EXISTS idx_import_history_created_at ON import_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_import_history_connection_id ON import_history(connection_id);

-- Enable RLS (Row Level Security)
ALTER TABLE import_history ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own import history
CREATE POLICY "Users can view their own import history"
    ON import_history
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Users can insert their own import history
CREATE POLICY "Users can insert their own import history"
    ON import_history
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own import history
CREATE POLICY "Users can delete their own import history"
    ON import_history
    FOR DELETE
    USING (auth.uid() = user_id);

