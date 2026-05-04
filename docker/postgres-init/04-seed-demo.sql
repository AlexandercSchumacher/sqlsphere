-- =====================================================================
-- Seed demo connections so the recruiter has something to click
-- immediately after `docker compose up`.
-- =====================================================================

\connect sqlsphere

-- Two demo connections:
--   1. "SQLSphere Internal" — points at the metadata DB (always works,
--      lets you query the connections / query_history tables).
--   2. "Chinook" — points at the chinook DB; requires the optional
--      Chinook dataset (see 03-chinook-data.sql) for full data.

INSERT INTO public.connections (
    id,
    user_id,
    name,
    type,
    connection_method,
    host,
    port,
    database,
    username,
    password,
    use_ssl,
    is_default,
    status,
    auth_method,
    created_at,
    updated_at
)
VALUES
(
    '11111111-1111-1111-1111-111111111111',
    '00000000-0000-0000-0000-000000000001',
    'Demo: SQLSphere Internal',
    'postgres',
    'standard',
    'postgres',
    5432,
    'sqlsphere',
    'postgres',
    encrypt_credential('demo'),
    false,
    true,
    'connected',
    'standard',
    NOW(),
    NOW()
),
(
    '22222222-2222-2222-2222-222222222222',
    '00000000-0000-0000-0000-000000000001',
    'Demo: Chinook',
    'postgres',
    'standard',
    'postgres',
    5432,
    'chinook',
    'postgres',
    encrypt_credential('demo'),
    false,
    false,
    'connected',
    'standard',
    NOW(),
    NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Default user_settings row so the frontend doesn't have to upsert on first load.
INSERT INTO public.user_settings (user_id, dark_mode, language, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001', true, 'en', NOW(), NOW())
ON CONFLICT (user_id) DO NOTHING;
