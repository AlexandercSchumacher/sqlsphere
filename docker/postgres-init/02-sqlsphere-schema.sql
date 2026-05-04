-- =====================================================================
-- SQLSphere LOCAL_MODE schema
-- =====================================================================
-- Consolidated from the original Supabase migrations.
--
-- Migration order is NOT strict filename-alphabetical, because the
-- original Supabase project relied on tables created via the dashboard
-- UI before some of the timestamped migrations were authored. We re-run
-- them in dependency-correct logical order:
--
--   1. profiles, connections, chat_sessions (creates) and their early ALTERs
--   2. encryption infrastructure (the various credential-encryption iterations)
--   3. user_usage, user_settings
--   4. advanced connection fields, the "five features" expansion
--   5. report / alert builder v2
--
-- Other adaptations:
--   * Stub `auth` schema (table + uid()) so FKs and policies still parse.
--   * Hardcoded demo user 00000000-0000-0000-0000-000000000001.
--   * encryption_keys table is created and seeded here (missing from
--     original migrations).
--   * RLS DISABLED on all public tables at the end.
-- =====================================================================

\connect sqlsphere

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
ALTER DATABASE sqlsphere SET search_path TO public, extensions;
SET search_path TO public, extensions;

-- Stub Supabase roles so GRANT statements in the migrations resolve.
-- These roles have no real privileges; postgres (the only login role
-- in LOCAL_MODE) is owner of everything anyway.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;
END$$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY,
    email TEXT,
    raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
    SELECT '00000000-0000-0000-0000-000000000001'::uuid;
$$ LANGUAGE SQL STABLE;

INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'demo@sqlsphere.local',
    '{"name": "Demo User"}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.encryption_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    key_data BYTEA NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO public.encryption_keys (name, key_data)
VALUES ('connection_credentials', extensions.gen_random_bytes(32))
ON CONFLICT (name) DO NOTHING;

-- =====================================================================
-- Begin original Supabase migrations (logical-dependency order)
-- =====================================================================


-- ===== 20251101212155_f390658b-c48e-4ebd-a44e-e8d13aa6d50d.sql =====

-- Create profiles table for user data
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own profile" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" 
ON public.profiles 
FOR UPDATE 
USING (auth.uid() = id);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_profiles_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger to create profile on signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===== 20251108141302_171d26d4-c8d6-453d-857e-63c2a05d41ea.sql =====

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

-- ===== 20250120000000_add_metadata_to_connections.sql =====

-- Add metadata JSONB column to connections table for storing FastAPI session IDs
ALTER TABLE public.connections
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- Add index for metadata queries
CREATE INDEX IF NOT EXISTS idx_connections_metadata ON public.connections USING gin (metadata);



-- ===== 20250125000000_create_import_history.sql =====

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



-- ===== 20250126000000_add_preview_data_to_import_history.sql =====

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



-- ===== 20251113085445_123ffe2d-1661-45f4-91d2-beb969e383b7.sql =====

-- Create chat_sessions table
CREATE TABLE public.chat_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  connection_id UUID REFERENCES public.connections(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create chat_messages table
CREATE TABLE public.chat_messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  table_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on chat_sessions
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

-- Enable RLS on chat_messages
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- RLS policies for chat_sessions
CREATE POLICY "Users can view their own chat sessions"
ON public.chat_sessions
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own chat sessions"
ON public.chat_sessions
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own chat sessions"
ON public.chat_sessions
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own chat sessions"
ON public.chat_sessions
FOR DELETE
USING (auth.uid() = user_id);

-- RLS policies for chat_messages
CREATE POLICY "Users can view messages from their chat sessions"
ON public.chat_messages
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.chat_sessions
    WHERE chat_sessions.id = chat_messages.session_id
    AND chat_sessions.user_id = auth.uid()
  )
);

CREATE POLICY "Users can create messages in their chat sessions"
ON public.chat_messages
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.chat_sessions
    WHERE chat_sessions.id = chat_messages.session_id
    AND chat_sessions.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete messages from their chat sessions"
ON public.chat_messages
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.chat_sessions
    WHERE chat_sessions.id = chat_messages.session_id
    AND chat_sessions.user_id = auth.uid()
  )
);

-- Add trigger for chat_sessions updated_at
CREATE TRIGGER update_chat_sessions_updated_at
BEFORE UPDATE ON public.chat_sessions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for better query performance
CREATE INDEX idx_chat_messages_session_id ON public.chat_messages(session_id);
CREATE INDEX idx_chat_sessions_user_id ON public.chat_sessions(user_id);

-- ===== 20251113213140_c8a6334e-61f3-49b7-84af-b90dd8b4b2ef.sql =====

-- Add database_type column to chat_sessions table
ALTER TABLE public.chat_sessions 
ADD COLUMN database_type text;

-- ===== 20251117142807_e5e42c12-e9d1-48b0-af19-cc7988537c88.sql =====

-- Enable pgsodium extension for encryption (if not already enabled)
-- LOCAL_MODE: pgsodium not available in postgres:16-alpine, replaced by pgcrypto in later migration
-- CREATE EXTENSION IF NOT EXISTS pgsodium;

-- Step 1: Rename existing plaintext columns
ALTER TABLE public.connections 
RENAME COLUMN password TO password_plaintext;

ALTER TABLE public.connections 
RENAME COLUMN ssh_password TO ssh_password_plaintext;

ALTER TABLE public.connections 
RENAME COLUMN ssh_key_file TO ssh_key_file_plaintext;

-- Step 2: Add new encrypted columns using bytea type
-- These will store encrypted data
ALTER TABLE public.connections 
ADD COLUMN password bytea,
ADD COLUMN ssh_password bytea,
ADD COLUMN ssh_key_file bytea;

-- Step 3: Create helper functions for encryption/decryption
-- These use a simple symmetric encryption approach
CREATE OR REPLACE FUNCTION public.encrypt_credential(plaintext text)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF plaintext IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Use pgcrypto's encryption with a key derived from the project
  -- In production, this key should be stored in Supabase secrets
  RETURN pgsodium.crypto_secretbox_noncegen(
    plaintext::bytea,
    gen_random_bytes(24)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.decrypt_credential(encrypted bytea)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF encrypted IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Decrypt the credential
  -- Note: This is a simplified version. In production, you'd use proper key management
  RETURN convert_from(encrypted, 'UTF8');
END;
$$;

-- Step 4: Migrate existing plaintext data to encrypted format
-- For now, we'll just store the plaintext as bytea (encoded)
-- A proper encryption implementation would require storing encryption keys securely
UPDATE public.connections
SET 
  password = encode(password_plaintext::bytea, 'base64')::bytea,
  ssh_password = encode(ssh_password_plaintext::bytea, 'base64')::bytea,
  ssh_key_file = encode(ssh_key_file_plaintext::bytea, 'base64')::bytea
WHERE password_plaintext IS NOT NULL 
   OR ssh_password_plaintext IS NOT NULL 
   OR ssh_key_file_plaintext IS NOT NULL;

-- Step 5: Drop the old plaintext columns
ALTER TABLE public.connections 
DROP COLUMN password_plaintext,
DROP COLUMN ssh_password_plaintext,
DROP COLUMN ssh_key_file_plaintext;

-- Add comments to document the encryption
COMMENT ON COLUMN public.connections.password IS 'Encrypted database password using base64 encoding (replace with proper encryption in production)';
COMMENT ON COLUMN public.connections.ssh_password IS 'Encrypted SSH password using base64 encoding (replace with proper encryption in production)';
COMMENT ON COLUMN public.connections.ssh_key_file IS 'Encrypted SSH key file using base64 encoding (replace with proper encryption in production)';

-- ===== 20251117145958_35afceb3-638e-44f0-91bd-d71c30620fe2.sql =====

-- Enable pgsodium extension for encryption
-- LOCAL_MODE: pgsodium not available in postgres:16-alpine, replaced by pgcrypto in later migration
-- CREATE EXTENSION IF NOT EXISTS pgsodium;

-- Drop existing insecure functions
DROP FUNCTION IF EXISTS public.encrypt_credential(text);
DROP FUNCTION IF EXISTS public.decrypt_credential(bytea);

-- Create secure encryption function using pgsodium
-- Uses authenticated encryption with a key derived from Supabase secrets
CREATE OR REPLACE FUNCTION public.encrypt_credential(plaintext text)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  encryption_key bytea;
BEGIN
  IF plaintext IS NULL OR plaintext = '' THEN
    RETURN NULL;
  END IF;
  
  -- Get or create encryption key from pgsodium key management
  -- This uses Supabase's built-in key management
  encryption_key := pgsodium.crypto_secretbox_keygen();
  
  -- Use authenticated encryption (secretbox) for credentials
  -- This provides both confidentiality and integrity
  RETURN pgsodium.crypto_secretbox(
    plaintext::bytea,
    pgsodium.crypto_secretbox_noncegen(),
    encryption_key
  );
END;
$$;

-- Create secure decryption function
CREATE OR REPLACE FUNCTION public.decrypt_credential(encrypted bytea)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  decrypted bytea;
  encryption_key bytea;
BEGIN
  IF encrypted IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Get the encryption key
  encryption_key := pgsodium.crypto_secretbox_keygen();
  
  -- Decrypt using secretbox_open
  -- This will fail if the ciphertext has been tampered with
  decrypted := pgsodium.crypto_secretbox_open(
    encrypted,
    encryption_key
  );
  
  IF decrypted IS NULL THEN
    RAISE EXCEPTION 'Decryption failed - data may be corrupted or tampered with';
  END IF;
  
  RETURN convert_from(decrypted, 'UTF8');
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Decryption error: %', SQLERRM;
END;
$$;

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION public.encrypt_credential(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decrypt_credential(bytea) TO authenticated;
GRANT EXECUTE ON FUNCTION public.encrypt_credential(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.decrypt_credential(bytea) TO service_role;

-- Re-encrypt existing credentials using the new secure encryption
-- This is safe because the old base64 "encryption" can be decoded
DO $$
DECLARE
  conn RECORD;
  decrypted_value text;
BEGIN
  FOR conn IN SELECT id, password, ssh_password, ssh_key_file FROM connections WHERE password IS NOT NULL OR ssh_password IS NOT NULL OR ssh_key_file IS NOT NULL
  LOOP
    -- Re-encrypt password if exists
    IF conn.password IS NOT NULL THEN
      BEGIN
        -- Try to decode base64 (old format)
        decrypted_value := convert_from(conn.password, 'UTF8');
        UPDATE connections 
        SET password = public.encrypt_credential(decrypted_value)
        WHERE id = conn.id;
      EXCEPTION WHEN OTHERS THEN
        -- If already encrypted or invalid, skip
        RAISE NOTICE 'Skipping password re-encryption for connection %', conn.id;
      END;
    END IF;
    
    -- Re-encrypt ssh_password if exists
    IF conn.ssh_password IS NOT NULL THEN
      BEGIN
        decrypted_value := convert_from(conn.ssh_password, 'UTF8');
        UPDATE connections 
        SET ssh_password = public.encrypt_credential(decrypted_value)
        WHERE id = conn.id;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Skipping ssh_password re-encryption for connection %', conn.id;
      END;
    END IF;
    
    -- Re-encrypt ssh_key_file if exists
    IF conn.ssh_key_file IS NOT NULL THEN
      BEGIN
        decrypted_value := convert_from(conn.ssh_key_file, 'UTF8');
        UPDATE connections 
        SET ssh_key_file = public.encrypt_credential(decrypted_value)
        WHERE id = conn.id;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Skipping ssh_key_file re-encryption for connection %', conn.id;
      END;
    END IF;
  END LOOP;
END;
$$;

-- ===== 20251117154724_5b1cb471-eca0-428d-a123-d667e5a716fd.sql =====

-- Ensure pgcrypto is available
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Replace broken pgsodium-based functions with pgcrypto-based versions using the persistent key
DROP FUNCTION IF EXISTS public.encrypt_credential(text);
DROP FUNCTION IF EXISTS public.decrypt_credential(bytea);

-- Encrypt using a persistent key from public.encryption_keys (name='connection_credentials')
CREATE OR REPLACE FUNCTION public.encrypt_credential(plaintext text)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k bytea;
BEGIN
  IF plaintext IS NULL OR plaintext = '' THEN
    RETURN NULL;
  END IF;

  SELECT key_data INTO k
  FROM public.encryption_keys
  WHERE name = 'connection_credentials'
  LIMIT 1;

  IF k IS NULL THEN
    RAISE EXCEPTION 'Encryption key not found';
  END IF;

  -- Use AES-256 via pgcrypto; store as bytea
  RETURN pgp_sym_encrypt(plaintext, encode(k, 'hex'), 'cipher-algo=aes256,compress-algo=0');
END;
$$;

-- Decrypt using the same persistent key
CREATE OR REPLACE FUNCTION public.decrypt_credential(encrypted bytea)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k bytea;
BEGIN
  IF encrypted IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT key_data INTO k
  FROM public.encryption_keys
  WHERE name = 'connection_credentials'
  LIMIT 1;

  IF k IS NULL THEN
    RAISE EXCEPTION 'Encryption key not found';
  END IF;

  RETURN pgp_sym_decrypt(encrypted, encode(k, 'hex'));
END;
$$;

-- Tighten permissions
REVOKE ALL ON FUNCTION public.encrypt_credential(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decrypt_credential(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encrypt_credential(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decrypt_credential(bytea) TO authenticated, service_role;

-- ===== 20251117154803_9c4eba14-e402-430b-82de-82d237e7a307.sql =====

-- Ensure pgcrypto is available
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Replace broken pgsodium-based functions with pgcrypto-based versions using the persistent key
DROP FUNCTION IF EXISTS public.encrypt_credential(text);
DROP FUNCTION IF EXISTS public.decrypt_credential(bytea);

-- Encrypt using a persistent key from public.encryption_keys (name='connection_credentials')
CREATE OR REPLACE FUNCTION public.encrypt_credential(plaintext text)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k bytea;
BEGIN
  IF plaintext IS NULL OR plaintext = '' THEN
    RETURN NULL;
  END IF;

  SELECT key_data INTO k
  FROM public.encryption_keys
  WHERE name = 'connection_credentials'
  LIMIT 1;

  IF k IS NULL THEN
    RAISE EXCEPTION 'Encryption key not found';
  END IF;

  -- Use AES-256 via pgcrypto; store as bytea
  RETURN pgp_sym_encrypt(plaintext, encode(k, 'hex'), 'cipher-algo=aes256,compress-algo=0');
END;
$$;

-- Decrypt using the same persistent key
CREATE OR REPLACE FUNCTION public.decrypt_credential(encrypted bytea)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k bytea;
BEGIN
  IF encrypted IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT key_data INTO k
  FROM public.encryption_keys
  WHERE name = 'connection_credentials'
  LIMIT 1;

  IF k IS NULL THEN
    RAISE EXCEPTION 'Encryption key not found';
  END IF;

  RETURN pgp_sym_decrypt(encrypted, encode(k, 'hex'));
END;
$$;

-- Tighten permissions
REVOKE ALL ON FUNCTION public.encrypt_credential(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decrypt_credential(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.encrypt_credential(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decrypt_credential(bytea) TO authenticated, service_role;

-- ===== 20251117201148_21e728bf-a699-456b-9332-3dad9fdc992e.sql =====

-- Fix type casting issue in encryption functions
CREATE OR REPLACE FUNCTION public.encrypt_credential(plaintext text)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k bytea;
  key_hex text;
BEGIN
  IF plaintext IS NULL OR plaintext = '' THEN
    RETURN NULL;
  END IF;

  SELECT key_data INTO k
  FROM public.encryption_keys
  WHERE name = 'connection_credentials'
  LIMIT 1;

  IF k IS NULL THEN
    RAISE EXCEPTION 'Encryption key not found';
  END IF;

  -- Explicitly cast to text and use variable for cleaner type inference
  key_hex := encode(k, 'hex');
  RETURN pgp_sym_encrypt(plaintext::text, key_hex::text, 'cipher-algo=aes256,compress-algo=0'::text);
END;
$$;

CREATE OR REPLACE FUNCTION public.decrypt_credential(encrypted bytea)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k bytea;
  key_hex text;
BEGIN
  IF encrypted IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT key_data INTO k
  FROM public.encryption_keys
  WHERE name = 'connection_credentials'
  LIMIT 1;

  IF k IS NULL THEN
    RAISE EXCEPTION 'Encryption key not found';
  END IF;

  key_hex := encode(k, 'hex');
  RETURN pgp_sym_decrypt(encrypted, key_hex::text);
END;
$$;

-- ===== 20251117201345_92a5f949-65b6-46ad-bbc9-ad03f9403c51.sql =====

-- Use fully-qualified pgcrypto function names in the encryption helpers
CREATE OR REPLACE FUNCTION public.encrypt_credential(plaintext text)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k bytea;
  key_hex text;
BEGIN
  IF plaintext IS NULL OR plaintext = '' THEN
    RETURN NULL;
  END IF;

  SELECT key_data INTO k
  FROM public.encryption_keys
  WHERE name = 'connection_credentials'
  LIMIT 1;

  IF k IS NULL THEN
    RAISE EXCEPTION 'Encryption key not found';
  END IF;

  key_hex := encode(k, 'hex');
  -- Supabase installs extensions in the "extensions" schema
  RETURN extensions.pgp_sym_encrypt(plaintext::text, key_hex::text, 'cipher-algo=aes256,compress-algo=0'::text);
END;
$$;

CREATE OR REPLACE FUNCTION public.decrypt_credential(encrypted bytea)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k bytea;
  key_hex text;
BEGIN
  IF encrypted IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT key_data INTO k
  FROM public.encryption_keys
  WHERE name = 'connection_credentials'
  LIMIT 1;

  IF k IS NULL THEN
    RAISE EXCEPTION 'Encryption key not found';
  END IF;

  key_hex := encode(k, 'hex');
  -- Supabase installs extensions in the "extensions" schema
  RETURN extensions.pgp_sym_decrypt(encrypted, key_hex::text);
END;
$$;

-- ===== 20251118160051_6e4fe5aa-028c-4436-aa8f-90fe93ec475e.sql =====

-- Add soft delete column to chat_sessions
ALTER TABLE public.chat_sessions 
ADD COLUMN is_active boolean NOT NULL DEFAULT true;

-- Add index for better query performance when filtering active sessions
CREATE INDEX idx_chat_sessions_is_active ON public.chat_sessions(user_id, is_active) WHERE is_active = true;

-- Add deleted_at timestamp for audit trail
ALTER TABLE public.chat_sessions 
ADD COLUMN deleted_at timestamp with time zone;

-- ===== 20251129182015_edc73f43-73c7-48c5-b3a9-a7b4a3755e35.sql =====

-- Create table for tracking user usage (daily limits)
CREATE TABLE public.user_usage (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  usage_date date NOT NULL DEFAULT CURRENT_DATE,
  messages_sent integer NOT NULL DEFAULT 0,
  imports_count integer NOT NULL DEFAULT 0,
  visualizations_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id, usage_date)
);

-- Create table for tracking total imports (lifetime count for free tier limit)
CREATE TABLE public.user_lifetime_usage (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  total_imports integer NOT NULL DEFAULT 0,
  total_visualizations integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.user_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_lifetime_usage ENABLE ROW LEVEL SECURITY;

-- RLS policies for user_usage
CREATE POLICY "Users can view their own usage"
ON public.user_usage
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own usage"
ON public.user_usage
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own usage"
ON public.user_usage
FOR UPDATE
USING (auth.uid() = user_id);

-- RLS policies for user_lifetime_usage
CREATE POLICY "Users can view their own lifetime usage"
ON public.user_lifetime_usage
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own lifetime usage"
ON public.user_lifetime_usage
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own lifetime usage"
ON public.user_lifetime_usage
FOR UPDATE
USING (auth.uid() = user_id);

-- Add triggers for updated_at
CREATE TRIGGER update_user_usage_updated_at
BEFORE UPDATE ON public.user_usage
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_user_lifetime_usage_updated_at
BEFORE UPDATE ON public.user_lifetime_usage
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- ===== 20251214191256_ce6a5b2d-7a0b-4fae-ab4c-82a5b05e5921.sql =====

-- Create user_settings table for storing user preferences
CREATE TABLE public.user_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  dark_mode BOOLEAN NOT NULL DEFAULT false,
  language TEXT NOT NULL DEFAULT 'en',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "Users can view their own settings" 
ON public.user_settings 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own settings" 
ON public.user_settings 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own settings" 
ON public.user_settings 
FOR UPDATE 
USING (auth.uid() = user_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_user_settings_updated_at
BEFORE UPDATE ON public.user_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- ===== 20251215120000_add_default_flag_to_connections.sql =====

-- Add default flag to connections so users can mark a single default connection
ALTER TABLE public.connections
ADD COLUMN IF NOT EXISTS is_default boolean DEFAULT false;

-- Ensure that each user can have at most one default connection
CREATE UNIQUE INDEX IF NOT EXISTS unique_default_connection_per_user
ON public.connections(user_id)
WHERE is_default;




-- ===== 20260218000000_add_advanced_connection_fields.sql =====

-- Migration: Add advanced connection fields for full auth method support
-- Adds columns for: auth methods, SSL/TLS certs, Azure AD, AWS IAM, SQL Server extras

-- Authentication method
ALTER TABLE connections ADD COLUMN IF NOT EXISTS auth_method text DEFAULT 'sql_auth';

-- SSL/TLS mode
ALTER TABLE connections ADD COLUMN IF NOT EXISTS ssl_mode text;

-- SSL Certificate content (encrypted) and file paths
ALTER TABLE connections ADD COLUMN IF NOT EXISTS ssl_ca text;        -- encrypted PEM content
ALTER TABLE connections ADD COLUMN IF NOT EXISTS ssl_ca_path text;   -- plain file path
ALTER TABLE connections ADD COLUMN IF NOT EXISTS ssl_cert text;      -- encrypted PEM content
ALTER TABLE connections ADD COLUMN IF NOT EXISTS ssl_cert_path text;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS ssl_key text;       -- encrypted PEM content
ALTER TABLE connections ADD COLUMN IF NOT EXISTS ssl_key_path text;

-- Named Pipe (Windows) and Named Instance (SQL Server)
ALTER TABLE connections ADD COLUMN IF NOT EXISTS named_pipe text;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS named_instance text;

-- Azure AD credentials (client_secret encrypted)
ALTER TABLE connections ADD COLUMN IF NOT EXISTS azure_tenant_id text;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS azure_client_id text;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS azure_client_secret text;  -- encrypted

-- AWS IAM credentials (access_key and secret encrypted)
ALTER TABLE connections ADD COLUMN IF NOT EXISTS aws_region text;
ALTER TABLE connections ADD COLUMN IF NOT EXISTS aws_access_key_id text;         -- encrypted
ALTER TABLE connections ADD COLUMN IF NOT EXISTS aws_secret_access_key text;     -- encrypted
ALTER TABLE connections ADD COLUMN IF NOT EXISTS aws_use_instance_profile boolean DEFAULT false;

-- SQL Server TLS options
ALTER TABLE connections ADD COLUMN IF NOT EXISTS encrypt text;                        -- 'yes' | 'no' | 'strict'
ALTER TABLE connections ADD COLUMN IF NOT EXISTS trust_server_certificate boolean DEFAULT false;

-- Raw connection string (expert mode, encrypted)
ALTER TABLE connections ADD COLUMN IF NOT EXISTS connection_string_value text;  -- encrypted


-- ===== 20260305000001_add_five_features.sql =====

-- Migration: Add tables for 5 new features
-- 1. Scheduled Queries/Reports
-- 2. Query History & Favorites
-- 3. Natural Language Dashboards
-- 4. Data Alerts
-- 5. Shareable Query Links

-- Helper: reusable updated_at trigger function (idempotent)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────
-- Feature 2: Query History & Favorites
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS query_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES connections(id) ON DELETE SET NULL,
  sql_text text NOT NULL,
  status text NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'error')),
  execution_time_ms integer,
  row_count integer,
  error_message text,
  is_favorite boolean NOT NULL DEFAULT false,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_query_history_user_created ON query_history(user_id, created_at DESC);
CREATE INDEX idx_query_history_user_favorite ON query_history(user_id, is_favorite) WHERE is_favorite = true;

ALTER TABLE query_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own query history"
  ON query_history FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER set_query_history_updated_at
  BEFORE UPDATE ON query_history
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────
-- Feature 1: Scheduled Queries / Reports
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  name text NOT NULL,
  sql_text text NOT NULL,
  schedule_type text NOT NULL CHECK (schedule_type IN ('daily', 'weekly', 'monthly')),
  schedule_time time NOT NULL DEFAULT '08:00',
  schedule_day_of_week integer CHECK (schedule_day_of_week BETWEEN 0 AND 6),
  schedule_day_of_month integer CHECK (schedule_day_of_month BETWEEN 1 AND 28),
  timezone text NOT NULL DEFAULT 'UTC',
  email_recipients text[] NOT NULL DEFAULT '{}',
  output_format text NOT NULL DEFAULT 'csv' CHECK (output_format IN ('csv', 'json')),
  is_active boolean NOT NULL DEFAULT true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scheduled_queries_user ON scheduled_queries(user_id);
CREATE INDEX idx_scheduled_queries_next_run ON scheduled_queries(next_run_at) WHERE is_active = true;

ALTER TABLE scheduled_queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own scheduled queries"
  ON scheduled_queries FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER set_scheduled_queries_updated_at
  BEFORE UPDATE ON scheduled_queries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Run history
CREATE TABLE IF NOT EXISTS scheduled_query_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES scheduled_queries(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'error')),
  row_count integer,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scheduled_query_runs_schedule ON scheduled_query_runs(schedule_id, started_at DESC);

ALTER TABLE scheduled_query_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own schedule runs"
  ON scheduled_query_runs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM scheduled_queries sq
      WHERE sq.id = scheduled_query_runs.schedule_id
      AND sq.user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────
-- Feature 3: Natural Language Dashboards
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dashboards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dashboards_user ON dashboards(user_id);

ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own dashboards"
  ON dashboards FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER set_dashboards_updated_at
  BEFORE UPDATE ON dashboards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS dashboard_widgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dashboard_id uuid NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
  title text NOT NULL,
  nl_prompt text,
  sql_text text NOT NULL,
  chart_type text NOT NULL DEFAULT 'bar' CHECK (chart_type IN ('bar', 'line', 'area', 'pie', 'table')),
  chart_config jsonb NOT NULL DEFAULT '{}',
  cached_data jsonb,
  cached_at timestamptz,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dashboard_widgets_dashboard ON dashboard_widgets(dashboard_id, position);

ALTER TABLE dashboard_widgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own dashboard widgets"
  ON dashboard_widgets FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM dashboards d
      WHERE d.id = dashboard_widgets.dashboard_id
      AND d.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM dashboards d
      WHERE d.id = dashboard_widgets.dashboard_id
      AND d.user_id = auth.uid()
    )
  );

CREATE TRIGGER set_dashboard_widgets_updated_at
  BEFORE UPDATE ON dashboard_widgets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─────────────────────────────────────────────────────────────
-- Feature 4: Data Alerts
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS data_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
  name text NOT NULL,
  nl_condition text NOT NULL,
  sql_text text NOT NULL,
  check_interval_minutes integer NOT NULL DEFAULT 60,
  email_recipients text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  last_checked_at timestamptz,
  last_triggered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_data_alerts_user ON data_alerts(user_id);
CREATE INDEX idx_data_alerts_active ON data_alerts(is_active, last_checked_at) WHERE is_active = true;

ALTER TABLE data_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own data alerts"
  ON data_alerts FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER set_data_alerts_updated_at
  BEFORE UPDATE ON data_alerts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- In-app notifications
CREATE TABLE IF NOT EXISTS alert_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  alert_id uuid REFERENCES data_alerts(id) ON DELETE SET NULL,
  title text NOT NULL,
  message text NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_alert_notifications_user ON alert_notifications(user_id, created_at DESC);
CREATE INDEX idx_alert_notifications_unread ON alert_notifications(user_id, is_read) WHERE is_read = false;

ALTER TABLE alert_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own notifications"
  ON alert_notifications FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Enable realtime for notifications
-- LOCAL_MODE: realtime is disabled (no Supabase). Notifications use polling.
-- ALTER PUBLICATION supabase_realtime ADD TABLE alert_notifications;

-- ─────────────────────────────────────────────────────────────
-- Feature 5: Shareable Query Links
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shared_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  title text NOT NULL,
  sql_text text NOT NULL,
  result_columns text[] NOT NULL DEFAULT '{}',
  result_data jsonb NOT NULL DEFAULT '[]',
  row_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_shared_queries_token ON shared_queries(token);
CREATE INDEX idx_shared_queries_user ON shared_queries(user_id);

ALTER TABLE shared_queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own shared queries"
  ON shared_queries FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Public access function (SECURITY DEFINER — bypasses RLS)
CREATE OR REPLACE FUNCTION get_shared_query(p_token text)
RETURNS TABLE (
  title text,
  sql_text text,
  result_columns text[],
  result_data jsonb,
  row_count integer,
  created_at timestamptz,
  expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT
      sq.title,
      sq.sql_text,
      sq.result_columns,
      sq.result_data,
      sq.row_count,
      sq.created_at,
      sq.expires_at
    FROM shared_queries sq
    WHERE sq.token = p_token
      AND sq.expires_at > now();
END;
$$;


-- ===== 20260306000002_report_builder_v2.sql =====

-- Report Builder v2: NL-driven schedules, preview metadata, and enriched run records

ALTER TABLE scheduled_queries
  ADD COLUMN IF NOT EXISTS query_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS nl_prompt text,
  ADD COLUMN IF NOT EXISTS generated_sql text,
  ADD COLUMN IF NOT EXISTS sql_final text,
  ADD COLUMN IF NOT EXISTS report_description text,
  ADD COLUMN IF NOT EXISTS include_chart boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS chart_type text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS chart_title text;

UPDATE scheduled_queries
SET sql_final = COALESCE(NULLIF(sql_final, ''), sql_text)
WHERE sql_final IS NULL OR sql_final = '';

ALTER TABLE scheduled_queries
  ALTER COLUMN sql_final SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scheduled_queries_query_mode_check'
  ) THEN
    ALTER TABLE scheduled_queries
      ADD CONSTRAINT scheduled_queries_query_mode_check
      CHECK (query_mode IN ('manual', 'nl'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scheduled_queries_chart_type_check'
  ) THEN
    ALTER TABLE scheduled_queries
      ADD CONSTRAINT scheduled_queries_chart_type_check
      CHECK (chart_type IN ('auto', 'bar', 'line', 'area', 'pie', 'table'));
  END IF;
END $$;

ALTER TABLE scheduled_query_runs
  ADD COLUMN IF NOT EXISTS summary_text text,
  ADD COLUMN IF NOT EXISTS chart_generated boolean NOT NULL DEFAULT false;


-- ===== 20260306000003_alert_builder_v2.sql =====

-- Alert Builder v2: NL SQL generation + preview-ready query persistence (no chart options)

ALTER TABLE data_alerts
  ADD COLUMN IF NOT EXISTS query_mode text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS nl_prompt text,
  ADD COLUMN IF NOT EXISTS generated_sql text,
  ADD COLUMN IF NOT EXISTS sql_final text;

UPDATE data_alerts
SET sql_final = COALESCE(NULLIF(sql_final, ''), sql_text)
WHERE sql_final IS NULL OR sql_final = '';

ALTER TABLE data_alerts
  ALTER COLUMN sql_final SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'data_alerts_query_mode_check'
  ) THEN
    ALTER TABLE data_alerts
      ADD CONSTRAINT data_alerts_query_mode_check
      CHECK (query_mode IN ('manual', 'nl'));
  END IF;
END $$;


-- =====================================================================
-- End of original migrations.
-- =====================================================================

DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT schemaname, tablename FROM pg_tables
        WHERE schemaname = 'public' AND rowsecurity = true
    LOOP
        EXECUTE format('ALTER TABLE %I.%I DISABLE ROW LEVEL SECURITY', r.schemaname, r.tablename);
    END LOOP;
END$$;
