-- Create the secondary database that holds the demo Chinook sample data.
-- The primary database "sqlsphere" is created by the postgres image via the
-- POSTGRES_DB env var.

CREATE DATABASE chinook;
