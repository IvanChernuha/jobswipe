-- Catch-up: columns the code uses that were added to the dev database by hand
-- and never written down as a migration (found 2026-11-08 by
-- backend/tests/migrations). Without this, a fresh database fails at
-- 013_bookmark_notes.sql (needs bookmarks.note) and the API breaks on bookmarks
-- and job experience filters.
--
-- Definitions copied from the dev database, so applying this to dev or Oracle
-- (where they already exist) changes nothing. Numbered 012b so it runs before 013.

-- Bookmarks: expiry (30 days, like jobs), the job a saved candidate is filed
-- under, and the worker's private note on a saved job.
ALTER TABLE public.bookmarks
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  ADD COLUMN IF NOT EXISTS job_posting_id uuid,
  ADD COLUMN IF NOT EXISTS note text DEFAULT '';

DO $$ BEGIN
  ALTER TABLE public.bookmarks
    ADD CONSTRAINT bookmarks_job_posting_id_fkey
    FOREIGN KEY (job_posting_id) REFERENCES public.job_postings(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_bookmarks_expires ON public.bookmarks(expires_at);

-- Jobs: minimum years of experience (the feed's experience filter and the job form).
ALTER TABLE public.job_postings
  ADD COLUMN IF NOT EXISTS min_experience_years integer;
