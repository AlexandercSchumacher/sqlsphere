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
