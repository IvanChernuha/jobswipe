-- Comeet import (OpenProject #3297, docs/worklog/comeet-import.md): employers
-- connect their hiring system once and their published jobs are imported and
-- kept in sync. Additive only.

CREATE TABLE IF NOT EXISTS public.ats_connections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider        text NOT NULL DEFAULT 'comeet' CHECK (provider IN ('comeet')),
  company_uid     text NOT NULL,
  token           text NOT NULL,              -- secret: API only, never returned
  company_name    text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'importing' CHECK (status IN ('importing', 'connected', 'error')),
  last_synced_at  timestamptz,
  last_error      text,
  sync_started_at timestamptz,                -- an 'importing' older than 1 h is stuck
  created_at      timestamptz DEFAULT now(),
  UNIQUE (employer_id, provider)
);

-- Only the API (service role) reads and writes it.
ALTER TABLE public.ats_connections ENABLE ROW LEVEL SECURITY;

-- Where an imported job came from.
ALTER TABLE public.job_postings
  ADD COLUMN IF NOT EXISTS source             text,
  ADD COLUMN IF NOT EXISTS source_id          text,
  ADD COLUMN IF NOT EXISTS source_url         text,
  ADD COLUMN IF NOT EXISTS source_updated_at  timestamptz,
  -- 'incomplete': an imported job held off by the job check until it's complete
  ADD COLUMN IF NOT EXISTS held_reason        text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_postings_source
  ON public.job_postings (employer_id, source, source_id)
  WHERE source IS NOT NULL;
