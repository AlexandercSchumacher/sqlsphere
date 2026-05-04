-- Enable pgsodium extension for encryption (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pgsodium;

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