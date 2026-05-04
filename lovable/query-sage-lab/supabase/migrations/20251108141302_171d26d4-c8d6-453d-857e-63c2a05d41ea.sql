-- Create connections table to persist user database connections
CREATE TABLE public.connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  connection_method text DEFAULT 'standard',
  host text,
  port integer,
  database text,
  username text,
  password text,
  use_ssl boolean DEFAULT false,
  ssh_host text,
  ssh_port integer,
  ssh_username text,
  ssh_password text,
  ssh_key_file text,
  socket_path text,
  default_schema text,
  status text DEFAULT 'unknown',
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;

-- Users can view their own connections
CREATE POLICY "Users can view their own connections"
ON public.connections
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- Users can insert their own connections
CREATE POLICY "Users can insert their own connections"
ON public.connections
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Users can update their own connections
CREATE POLICY "Users can update their own connections"
ON public.connections
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- Users can delete their own connections
CREATE POLICY "Users can delete their own connections"
ON public.connections
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- Add trigger for automatic timestamp updates
CREATE TRIGGER update_connections_updated_at
BEFORE UPDATE ON public.connections
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();