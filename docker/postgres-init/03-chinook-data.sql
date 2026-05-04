-- =====================================================================
-- Chinook sample database (placeholder)
-- =====================================================================
-- The Chinook sample dataset (a fake digital music store: 11 tables,
-- ~15 000 rows) is not bundled with this repo to keep the clone size
-- small and avoid shipping third-party SQL we did not author.
--
-- To populate the `chinook` database with the sample data:
--
--   curl -L https://raw.githubusercontent.com/lerocha/chinook-database/master/ChinookDatabase/DataSources/Chinook_PostgreSql.sql \
--     -o docker/postgres-init/03-chinook-data.sql
--   docker compose down -v && docker compose up
--
-- The Chinook project is licensed under the MIT License; see
-- https://github.com/lerocha/chinook-database for details.
--
-- Without this file, the "Demo: Chinook" connection in the UI will
-- exist but queries against it will fail (the chinook database is
-- empty). The "Demo: SQLSphere Internal" connection always works and
-- is sufficient for a quick smoke test.
-- =====================================================================

-- Switch to the chinook database that 01-databases.sql created.
\connect chinook

-- Add a marker row so the demo can show *something* even without the
-- full Chinook dataset. The frontend lists tables; this gives users a
-- visible "hello world" target.
CREATE TABLE IF NOT EXISTS chinook_placeholder (
    id SERIAL PRIMARY KEY,
    note TEXT
);

INSERT INTO chinook_placeholder (note) VALUES
  ('Chinook sample data is not loaded. See docker/postgres-init/03-chinook-data.sql for instructions.'),
  ('You can still run queries against the SQLSphere internal database via the "Demo: SQLSphere Internal" connection.');
