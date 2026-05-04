-- Add default flag to connections so users can mark a single default connection
ALTER TABLE public.connections
ADD COLUMN IF NOT EXISTS is_default boolean DEFAULT false;

-- Ensure that each user can have at most one default connection
CREATE UNIQUE INDEX IF NOT EXISTS unique_default_connection_per_user
ON public.connections(user_id)
WHERE is_default;


