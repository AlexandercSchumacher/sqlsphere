-- Add metadata JSONB column to connections table for storing FastAPI session IDs
ALTER TABLE public.connections
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Add index for metadata queries
CREATE INDEX IF NOT EXISTS idx_connections_metadata ON public.connections USING gin (metadata);

