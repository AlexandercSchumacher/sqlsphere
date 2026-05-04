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