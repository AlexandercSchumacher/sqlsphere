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