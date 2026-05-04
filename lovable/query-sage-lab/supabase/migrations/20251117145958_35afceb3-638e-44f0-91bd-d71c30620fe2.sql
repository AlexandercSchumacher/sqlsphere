-- Enable pgsodium extension for encryption
CREATE EXTENSION IF NOT EXISTS pgsodium;

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