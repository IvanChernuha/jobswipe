-- The bits of Supabase that supabase/migrations rely on, for a plain Postgres
-- test database: pgcrypto (Supabase enables it), the auth schema with its
-- users table, and auth.uid().
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id                 uuid PRIMARY KEY,
  email              text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_app_meta_data  jsonb DEFAULT '{}'::jsonb,
  created_at         timestamptz DEFAULT now()
);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
